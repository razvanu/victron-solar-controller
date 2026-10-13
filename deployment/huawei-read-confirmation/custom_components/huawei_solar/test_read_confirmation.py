"""Exercise the actual patched methods with simulated Modbus and HA boundaries.
No Home Assistant runtime or hardware is started by these unit tests.
"""
import ast
import asyncio
from datetime import UTC, datetime, timedelta
from itertools import chain
import logging
import math
from pathlib import Path
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parent
class UpdateFailed(Exception): pass
class HuaweiSolarException(Exception): pass
class ReadException(HuaweiSolarException):
    modbus_exception_code = 0
class ConnectionInterruptedException(HuaweiSolarException): pass


def extract(filename, class_name, method_name, env):
    tree = ast.parse((ROOT / filename).read_text(encoding='utf-8-sig'))
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == class_name)
    method = next(n for n in cls.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == method_name)
    method.decorator_list = []
    module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), method], type_ignores=[])
    ast.fix_missing_locations(module)
    exec(compile(module, str(ROOT / filename), 'exec'), env)
    return env[method_name]

class Clock:
    value = datetime(2026, 10, 13, 12, 0, tzinfo=UTC)
    @classmethod
    def now(cls, tz): return cls.value

ENV = dict(asyncio=asyncio, chain=chain, datetime=Clock, UTC=UTC,
           UpdateFailed=UpdateFailed, ReadException=ReadException,
           HuaweiSolarException=HuaweiSolarException,
           ConnectionInterruptedException=ConnectionInterruptedException,
           _LOGGER=logging.getLogger('test'))
read = extract('update_coordinator.py', 'HuaweiSolarUpdateCoordinator', '_async_update_data', ENV)
update = extract('sensor.py', 'HuaweiSolarSensorEntity', '_handle_coordinator_update',
                 {'math': math, '_READ_CONFIRMED_BATTERY_REGISTERS': {'soc', 'power'}})

class Device:
    serial_number = 'TEST_DEVICE'
    def __init__(self):
        self.data = {'soc': SimpleNamespace(value=99), 'power': SimpleNamespace(value=0)}
        self.error = None
        self.delay = 0
    async def batch_update(self, keys):
        if self.delay: await asyncio.sleep(self.delay)
        if self.error: raise self.error
        return self.data.copy()

def coordinator():
    return SimpleNamespace(device=Device(), update_timeout=timedelta(seconds=1),
        async_contexts=lambda: [{'register_names':['soc','power']}],
        last_successful_read={}, last_update_success=True, data=None)

def sensor(c, key='soc'):
    return SimpleNamespace(coordinator=c, _register_key=key,
        entity_description=SimpleNamespace(value_conversion_function=None),
        async_write_ha_state=lambda:None)

class HardwareConfirmationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        Clock.value = datetime(2026, 10, 13, 12, 0, tzinfo=UTC)
        self.c = coordinator()
    async def refresh(self):
        self.c.data = await read(self.c)
        self.c.last_update_success = True
    async def test_unchanged_measurement_gets_new_real_read_time(self):
        await self.refresh(); s = sensor(self.c); update(s)
        first = s._attr_extra_state_attributes.copy()
        Clock.value += timedelta(seconds=30)
        await self.refresh(); update(s)
        self.assertEqual(s._attr_native_value, 99)
        self.assertTrue(s._attr_extra_state_attributes['huawei_read_ok'])
        self.assertNotEqual(first['huawei_last_successful_read'], s._attr_extra_state_attributes['huawei_last_successful_read'])
    async def test_republishing_cached_state_does_not_renew_time(self):
        await self.refresh(); s = sensor(self.c); update(s)
        first = s._attr_extra_state_attributes.copy()
        Clock.value += timedelta(hours=1); update(s)
        self.assertEqual(first, s._attr_extra_state_attributes)
    async def test_partial_batch_does_not_confirm_missing_register(self):
        self.c.device.data.pop('power'); await self.refresh()
        s = sensor(self.c,'power'); update(s)
        self.assertFalse(s._attr_extra_state_attributes['huawei_read_ok'])
        self.assertIsNone(s._attr_extra_state_attributes['huawei_last_successful_read'])
        self.assertNotIn('power', self.c.last_successful_read)
    async def test_failure_invalidates_previous_confirmations(self):
        await self.refresh(); self.c.device.error = HuaweiSolarException('offline')
        with self.assertRaises(UpdateFailed): await read(self.c)
        self.c.last_update_success = False
        s = sensor(self.c); update(s)
        self.assertEqual(self.c.last_successful_read,{})
        self.assertFalse(s._attr_extra_state_attributes['huawei_read_ok'])
    async def test_timeout_invalidates_previous_confirmations(self):
        await self.refresh(); self.c.update_timeout = timedelta(milliseconds=1); self.c.device.delay = 1
        with self.assertRaises(UpdateFailed): await read(self.c)
        self.assertEqual(self.c.last_successful_read,{})
    async def test_read_exception_is_not_a_success(self):
        self.c.device.error = ReadException('bad read')
        with self.assertRaises(UpdateFailed): await read(self.c)
        self.assertEqual(self.c.last_successful_read,{})
    async def test_disconnect_is_not_a_success(self):
        self.c.device.error = ConnectionInterruptedException('disconnect')
        with self.assertRaises(UpdateFailed): await read(self.c)
        self.assertEqual(self.c.last_successful_read,{})
    async def test_cancelled_poll_cannot_confirm_cached_data(self):
        await self.refresh(); self.c.device.delay = 1
        task = asyncio.create_task(read(self.c)); await asyncio.sleep(.01); task.cancel()
        with self.assertRaises(asyncio.CancelledError): await task
        self.assertEqual(self.c.last_successful_read,{})
    async def test_invalid_numeric_values_not_confirmed(self):
        for value in (None, True, False, float('nan'), float('inf'), '99'):
            with self.subTest(value=value):
                self.c.device.data['soc'] = SimpleNamespace(value=value)
                await self.refresh(); s = sensor(self.c); update(s)
                self.assertFalse(s._attr_extra_state_attributes['huawei_read_ok'])
    async def test_other_sensor_does_not_prove_battery_read(self):
        self.c.device.data={'voltage':SimpleNamespace(value=434)};await self.refresh()
        for key in ('soc','power'):
            s=sensor(self.c,key);update(s)
            self.assertFalse(s._attr_extra_state_attributes['huawei_read_ok'])
    async def test_restart_requires_a_new_poll(self):
        self.c.data=self.c.device.data.copy();s=sensor(self.c);update(s)
        self.assertFalse(s._attr_extra_state_attributes['huawei_read_ok'])
    async def test_timestamp_is_batch_start_not_completion(self):
        async def batch(keys):
            Clock.value += timedelta(seconds=20)
            return self.c.device.data.copy()
        started=Clock.value;self.c.device.batch_update=batch
        await self.refresh()
        self.assertEqual(self.c.last_successful_read['soc'],started)
    async def test_nonbattery_sensor_is_unchanged(self):
        self.c.data={'voltage':SimpleNamespace(value=434)}
        s=sensor(self.c,'voltage');update(s)
        self.assertEqual(s._attr_native_value,434)
        self.assertFalse(hasattr(s,'_attr_extra_state_attributes'))

if __name__ == '__main__': unittest.main(verbosity=2)


