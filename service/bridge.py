#!/usr/bin/env python3
"""Local ESS discharge lease supervisor. No TCP listener; no automatic session resume."""
import base64, json, math, os, socket, sys, time, uuid, signal, fcntl, pwd
from pathlib import Path
RUN=Path('/run/solar-discharge')
SOCK=str(RUN/'control.sock')
JOURNAL=RUN/'ownership.json'
HUB='com.victronenergy.hub4'; SETTINGS='com.victronenergy.settings'; SYSTEM='com.victronenergy.system'
SP='/Overrides/Setpoint'; MP='/Overrides/MaxDischargePower'
LEASE=15.0

def numeric(v):
    if v is None or isinstance(v,(bool,list,dict,str)) or not math.isfinite(float(v)):
        raise ValueError('INVALID_TELEMETRY')
    return float(v)

def same(a,b):
    return a is None and b is None or a is not None and b is not None and abs(a-b)<0.5

class Bus:
    def __init__(self):
        import dbus
        self.d=dbus; self.bus=dbus.SystemBus()
    def owner(self): return str(self.bus.get_name_owner(HUB))
    def get(self,s,p):
        v=self.bus.get_object(s,p).GetValue(dbus_interface='com.victronenergy.BusItem',timeout=0.5)
        if isinstance(v,(self.d.Array,list)) and len(v)==0:return None
        return float(v)
    def set(self,p,v):
        value=self.d.Array([],signature='i',variant_level=1) if v is None else self.d.Double(v,variant_level=1)
        result=self.bus.get_object(HUB,p).SetValue(value,dbus_interface='com.victronenergy.BusItem',timeout=0.5)
        if int(result)!=0:raise RuntimeError('WRITE_REJECTED '+p)
        if not same(self.get(HUB,p),v):raise RuntimeError('WRITE_READBACK_FAILED '+p)
    def snapshot(self,instance):
        names=[str(n) for n in self.bus.list_names() if str(n).startswith('com.victronenergy.battery.')]
        matches=[n for n in names if self.get(n,'/DeviceInstance')==instance]
        if len(matches)!=1:raise ValueError('BATTERY_INSTANCE_NOT_UNIQUE')
        b=matches[0]
        def g(s,p):return numeric(self.get(s,p))
        s={k:g(b,p) for k,p in {'connected':'/Connected','soc':'/Soc','voltage':'/Dc/0/Voltage','current':'/Dc/0/Current','dcl':'/Info/MaxDischargeCurrent','mincell':'/System/MinCellVoltage','maxcell':'/System/MaxCellVoltage','temperature':'/Dc/0/Temperature'}.items()}
        s.update(grid=sum(g(SYSTEM,'/Ac/Grid/L%d/Power'%i) for i in [1,2,3]),
          source=g(SYSTEM,'/Ac/ActiveIn/Source'),mode=g(SETTINGS,'/Settings/CGwacs/Hub4Mode'),
          essstate=g(SETTINGS,'/Settings/CGwacs/BatteryLife/State'),
          minsoc=g(SETTINGS,'/Settings/CGwacs/BatteryLife/MinimumSocLimit'),
          active_soc=g(SYSTEM,'/Control/ActiveSocLimit'),
          dess=g(SETTINGS,'/Settings/DynamicEss/Mode'),
          base=g(SETTINGS,'/Settings/CGwacs/AcPowerSetPoint'),
          force=g(HUB,'/Overrides/ForceCharge'))
        # Invalid means no measured DC PV only when no solar charger is registered.
        pv=self.get(SYSTEM,'/Dc/Pv/Power')
        has_dc=any(str(n).startswith('com.victronenergy.solarcharger.') for n in self.bus.list_names())
        s['dcpv']=max(0,numeric(pv)) if pv is not None else (0 if not has_dc else numeric(None))
        return s

class Engine:
    def __init__(self,bus,clock=time.monotonic,wall=time.time,journal=JOURNAL):
        self.bus=bus;self.clock=clock;self.wall=wall;self.path=journal
        self.boot=uuid.uuid4().hex;self.session=None;self.owned={};self.owner=None
        self.reason='IDLE';self.error=None;self.last={};self.retired=set();self.last_tick=0
        self.recover()
    def record(self):
        if self.path is None:return
        p=self.path.with_suffix('.tmp');p.write_text(json.dumps({'owner':self.owner,'owned':self.owned}));os.replace(p,self.path)
    def recover(self):
        if self.path is not None and self.path.exists():
            try:
                j=json.loads(self.path.read_text());self.owner=j['owner'];self.owned=j['owned']
                self.stop('RECOVERED_PREVIOUS_PROCESS')
            except Exception:
                self.error='RECOVERY_FAILED';self.reason='FAULT'
    def write(self,p,v):
        old=self.bus.get(HUB,p)
        known=self.owned.get(p)
        if known and not any(same(old,x) for x in known):raise RuntimeError('OVERRIDE_CONFLICT')
        self.owned[p]=[old,v];self.record() # RAM journal precedes write for crash recovery
        self.bus.set(p,v)
        self.owned[p]=[v];self.record()
    def stop(self,reason):
        if self.session:self.retired.add(self.session['id'])
        self.session=None;self.reason=reason
        try:
            if self.owned and self.bus.owner()==self.owner:
                # Remove forced grid demand first; then release only power limit we own.
                for p,normal in [(SP,None),(MP,-1)]:
                    if p not in self.owned:continue
                    cur=self.bus.get(HUB,p)
                    if any(same(cur,v) for v in self.owned[p]):self.bus.set(p,normal)
                    elif not same(cur,normal):self.error='OVERRIDE_CONFLICT_EXTERNAL_WRITER'
                    self.owned.pop(p,None);self.record()
            self.owned={};self.owner=None;self.record()
            if self.error=='RESTORE_PENDING':self.error=None
        except Exception:
            self.error='RESTORE_PENDING';self.reason=reason
    def validate(self,s):
        for v in s.values():numeric(v)
        if s['connected']!=1:raise ValueError('BMS_DISCONNECTED')
        if s['source']!=1:raise ValueError('GRID_NOT_CONNECTED')
        if s['mode']!=1:raise ValueError('ESS_NET_3PH_REQUIRED')
        if s['essstate'] not in (2,3,4,10):raise ValueError('ESS_NOT_SELF_CONSUMPTION')
        if s['dess']!=0 or s['force']!=0:raise ValueError('DESS_OR_SCHEDULED_CHARGE_ACTIVE')
        if s['base']<0:raise ValueError('BASE_SETPOINT_ALREADY_EXPORTS')
        if not 0<=s['soc']<=100 or not 40<=s['voltage']<=60:raise ValueError('BATTERY_VALUES_INVALID')
        if not 2<=s['mincell']<=s['maxcell']<=4:raise ValueError('CELL_VALUES_INVALID')
        if s['mincell']<=3.10 or s['voltage']<=50:raise ValueError('LOW_BATTERY_VOLTAGE')
        if not 5<=s['temperature']<=45:raise ValueError('TEMPERATURE_OUTSIDE_RANGE')
        if s['dcl']<=0:raise ValueError('BMS_DCL_ZERO')
    def status(self):
        r={'ok':not bool(self.error),'boot':self.boot,'active':self.session is not None,'reason':self.reason,'error':self.error,'restoring':bool(self.owned) and self.session is None,**self.last}
        if self.session:
            r.update(id=self.session['id'],amps=self.session['amps'],stopSoc=self.session['stopSoc'],remainingSec=max(0,int(self.session['deadline']-self.clock())))
        return r
    def request(self,r):
        action=r.get('action')
        if action=='status':return self.status()
        if action=='stop':
            # An owner session or restart with no local request can cancel existing work.
            self.stop('MANUAL_OR_CONTROLLER_STOP');return self.status()
        if action!='pulse':raise ValueError('UNKNOWN_ACTION')
        if r.get('boot')!=self.boot:raise ValueError('HELPER_RESTARTED_REQUEST_NEW_COMMAND')
        ident=r.get('id','')
        if not isinstance(ident,str) or not 10<=len(ident)<=100:raise ValueError('INVALID_ID')
        if ident in self.retired:raise ValueError('SESSION_FINISHED_SEND_NEW_COMMAND')
        if self.error:raise ValueError('HELPER_FAULT_'+self.error)
        if not self.session:
            if not 0<=self.wall()-numeric(r.get('issuedAt'))<=15:raise ValueError('EXPIRED_START_REQUEST')
            amps=numeric(r.get('amps'));minutes=numeric(r.get('minutes'));soc=numeric(r.get('stopSoc'))
            if not 1<=amps<=50 or not 1<=minutes<=240 or not 20<=soc<=95:raise ValueError('LIMITS_1_50A_1_240MIN_SOC20_95')
            s=self.bus.snapshot(int(r.get('instance',512)));self.validate(s)
            floor=max(soc,s['minsoc'],s['active_soc'],20)
            if s['soc']<=floor+0.5:raise ValueError('SOC_ALREADY_AT_FLOOR')
            if amps>s['dcl']:raise ValueError('REQUEST_EXCEEDS_BMS_DCL')
            if self.bus.get(HUB,SP) is not None or self.bus.get(HUB,MP)!=-1:raise ValueError('OVERRIDES_IN_USE')
            self.owner=self.bus.owner()
            self.session={'id':ident,'amps':amps,'stopSoc':floor,'deadline':self.clock()+minutes*60,'lease':self.clock()+LEASE,'instance':int(r.get('instance',512)),'sp':min(0,s['grid']),'oversince':None,'started':self.clock(),'lastreg':0}
            self.reason='STARTING';self.last={}
            self.tick(force=True)
        elif self.session['id']==ident:
            if self.clock()>=self.session['lease'] or self.clock()>=self.session['deadline']:
                self.stop('LEASE_OR_TIME_EXPIRED');return self.status()
            self.session['lease']=self.clock()+LEASE
        else:raise ValueError('ANOTHER_SESSION_ACTIVE')
        return self.status()
    def tick(self,force=False):
        t=self.clock()
        if not self.session:
            if self.owned:self.stop(self.reason)
            return
        s0=self.session
        if t>=s0['lease']:self.stop('NODE_RED_HEARTBEAT_LOST');return
        if t>=s0['deadline']:self.stop('TIME_REACHED');return
        if not force and t-self.last_tick<1:return
        self.last_tick=t
        try:
            if self.bus.owner()!=self.owner:raise ValueError('ESS_SERVICE_RESTARTED')
            s=self.bus.snapshot(s0['instance']);self.validate(s)
            floor=max(s0['stopSoc'],s['minsoc'],s['active_soc'],20)
            if s['soc']<=floor:self.stop('SOC_REACHED');return
            target=min(s0['amps'],s['dcl'])
            measured=-s['current']
            if measured>s['dcl']+1:raise ValueError('BMS_DCL_EXCEEDED')
            if measured>target+5:
                if s0['oversince'] is None:s0['oversince']=t
                if t-s0['oversince']>=10:raise ValueError('CURRENT_OVERSHOOT')
            else:s0['oversince']=None
            for p,values in self.owned.items():
                if not any(same(self.bus.get(HUB,p),v) for v in values):raise ValueError('OVERRIDE_CONFLICT')
            self.last={'currentA':round(measured,2),'effectiveA':target,'soc':s['soc'],'effectiveStopSoc':floor,'gridW':s['grid'],'minCellV':s['mincell']}
            # DC cap includes DC PV; battery-current feedback compensates loads and AC PV.
            powercap=min(3000,max(0,target*s['voltage']+s['dcpv']))
            oldcap=self.bus.get(HUB,MP)
            if oldcap<0 or powercap<oldcap or t-s0['lastreg']>=5:self.write(MP,powercap)
            if force or t-s0['lastreg']>=5:
                error=target+s['current']
                candidate=s['grid']-0.6*error*s['voltage']*0.95
                desired=max(-12000,min(-50,candidate))
                old=s0['sp'];sp=max(old-300,min(old+300,desired));sp=max(-12000,min(0,sp))
                self.write(SP,round(sp));s0['sp']=round(sp);s0['lastreg']=t
            self.reason='RUNNING';self.last['setpointW']=s0['sp']
        except Exception as e:self.stop(str(e) if isinstance(e,ValueError) else 'DBUS_OR_WRITE_ERROR')

def client(encoded):
    try:
        raw=base64.urlsafe_b64decode(encoded+'='*((-len(encoded))%4));r=json.loads(raw)
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as sock:
            sock.settimeout(12);sock.connect(SOCK);sock.sendall(json.dumps(r).encode()+b'\n');data=b''
            while b'\n' not in data:
                part=sock.recv(65536)
                if not part:break
                data+=part
            print(data.decode().strip())
    except Exception:print(json.dumps({'ok':False,'active':False,'error':'HELPER_UNAVAILABLE','reason':'CHECK_LOCAL_SERVICE'}))

def daemon():
    RUN.mkdir(mode=0o750,exist_ok=True)
    lock=open(RUN/'lock','w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    user=pwd.getpwnam('nodered');os.chown(RUN,0,user.pw_gid);os.chmod(RUN,0o750)
    bus=Bus();engine=Engine(bus)
    if os.path.exists(SOCK):os.unlink(SOCK)
    sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);sock.bind(SOCK);os.chown(SOCK,0,user.pw_gid);os.chmod(SOCK,0o660);sock.listen(4);sock.settimeout(0.25)
    stopping=False
    def terminate(*_):
        nonlocal stopping
        stopping=True
    signal.signal(signal.SIGTERM,terminate);signal.signal(signal.SIGINT,terminate)
    try:
        while not stopping:
            engine.tick()
            try:conn,_=sock.accept()
            except socket.timeout:continue
            with conn:
                conn.settimeout(0.5)
                try:
                    data=b''
                    while b'\n' not in data and len(data)<8192:
                        part=conn.recv(8192)
                        if not part:break
                        data+=part
                    reply=engine.request(json.loads(data))
                except Exception as e:reply={**engine.status(),'ok':False,'requestError':str(e)[:160]}
                try:conn.sendall(json.dumps(reply).encode()+b'\n')
                except OSError:pass
    finally:
        engine.stop('SERVICE_STOP');sock.close()
        if os.path.exists(SOCK):os.unlink(SOCK)

if __name__=='__main__':
    if len(sys.argv)>2 and sys.argv[1]=='client':client(sys.argv[2])
    elif len(sys.argv)>1 and sys.argv[1]=='daemon':daemon()
    elif len(sys.argv)>1 and sys.argv[1]=='probe':
        b=Bus();s=b.snapshot(512);print(json.dumps({'telemetry':s,'override':b.get(HUB,SP),'maxDischargeOverride':b.get(HUB,MP)},indent=2))
    else:raise SystemExit('Usage: bridge.py daemon | client BASE64 | probe')
