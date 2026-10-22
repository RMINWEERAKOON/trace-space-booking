import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, Bell, CalendarDays, Check, CheckCircle2,
  ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, DoorOpen, Download, Filter, LayoutDashboard, Mail, Menu,
  MoreHorizontal, Plus, Search, Settings, ShieldCheck, SlidersHorizontal, Users, X, Building2, Calendar,
  BriefcaseBusiness, Armchair, MapPin, CalendarCheck, Ban, RefreshCw, Send, Sparkles, Wallet,
  ClipboardList, CircleDollarSign, ExternalLink, LogOut, KeyRound, LockKeyhole
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const TOKEN_KEY = 'trace_auth_token';
const currency = n => new Intl.NumberFormat('en-LK', { style: 'currency', currency: 'LKR', maximumFractionDigits: 0 }).format(Number(n || 0));
const dateLabel = value => value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—';
const localDateString = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const today = () => localDateString(new Date());
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate()+n); return localDateString(d); };
const timeToMinutes = value => { if (!/^\d{2}:\d{2}$/.test(value || '')) return NaN; const [h,m]=value.split(':').map(Number); return h*60+m; };
const categoryLabels = { meeting_room: 'Meeting & training', auditorium: 'Auditorium', coworking_desk: 'Co-working desk' };
const categoryIcons = { meeting_room: DoorOpen, auditorium: Building2, coworking_desk: Armchair };

async function request(path, options = {}) {
  const { skipAuth = false, ...fetchOptions } = options;
  const token = !skipAuth && typeof window !== 'undefined' ? window.sessionStorage.getItem(TOKEN_KEY) : null;
  const headers = { 'Content-Type':'application/json', ...(fetchOptions.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API}${path}`, { ...fetchOptions, headers });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== '/auth/login' && typeof window !== 'undefined') {
    window.sessionStorage.removeItem(TOKEN_KEY);
    window.dispatchEvent(new Event('trace:unauthorized'));
  }
  if (!response.ok) throw new Error(data.error || data.message || 'Something went wrong.');
  return data;
}
function Button({ children, variant='primary', icon: Icon, onClick, type='button', disabled=false, className='' }) {
  return <button type={type} disabled={disabled} className={`button ${variant} ${className}`} onClick={onClick}>{Icon && <Icon size={16}/>}<span>{children}</span></button>;
}
function StatCard({ title, value, sub, icon: Icon, tone='green', trend }) {
  return <div className="stat-card"><div className={`stat-icon ${tone}`}><Icon size={20}/></div><div className="stat-copy"><div className="stat-title">{title}</div><div className="stat-value">{value}</div><div className="stat-sub">{trend && <span className="trend"><ArrowUpRight size={13}/>{trend}</span>}{sub}</div></div></div>;
}
function StatusPill({ status }) { return <span className={`status-pill ${status === 'confirmed' ? 'confirmed' : status === 'cancelled' ? 'cancelled' : status === 'available' ? 'available' : 'booked'}`}><span/>{status === 'confirmed' ? 'Confirmed' : status === 'cancelled' ? 'Cancelled' : status === 'available' ? 'Available' : status}</span>; }
function Field({ label, children, required=false, hint }) { return <label className="field"><span className="field-label">{label}{required && <b> *</b>}</span>{children}{hint && <small>{hint}</small>}</label>; }
function Modal({ title, subtitle, onClose, children, wide=false }) { return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}><section className={`modal ${wide?'wide':''}`}><div className="modal-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19}/></button></div>{children}</section></div>; }

export default function App() {
  const [page,setPage] = useState('Overview');
  const [authStatus,setAuthStatus] = useState(() => typeof window !== 'undefined' && window.sessionStorage.getItem(TOKEN_KEY) ? 'checking' : 'signedOut');
  const [currentUser,setCurrentUser] = useState(null);
  const [mobileNav,setMobileNav] = useState(false);
  const [spaces,setSpaces] = useState([]);
  const [bookings,setBookings] = useState([]);
  const [dashboard,setDashboard] = useState(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [toast,setToast] = useState(null);
  const [bookingModal,setBookingModal] = useState(false);
  const [calendarSpace,setCalendarSpace] = useState(null);
  const [inquiryModal,setInquiryModal] = useState(false);
  const [selectedBooking,setSelectedBooking] = useState(null);
  const [search,setSearch] = useState('');
  const [statusFilter,setStatusFilter] = useState('all');
  const [categoryFilter,setCategoryFilter] = useState('all');
  const [availabilityDate,setAvailabilityDate] = useState(today());
  const [availabilityEnd,setAvailabilityEnd] = useState(today());
  const [availabilityUnit,setAvailabilityUnit] = useState('day');
  const [availabilityStartTime,setAvailabilityStartTime] = useState('09:00');
  const [availabilityEndTime,setAvailabilityEndTime] = useState('11:00');
  const [availability,setAvailability] = useState([]);
  const [availabilityLoading,setAvailabilityLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [s,b,d] = await Promise.all([request('/spaces'),request('/bookings'),request('/dashboard')]);
      setSpaces(s); setBookings(b); setDashboard(d);
    } catch (e) { setError(`${e.message} Check that the API is running on port 4000.`); }
    finally { setLoading(false); }
  },[]);
  useEffect(() => {
    const onUnauthorized = () => {
      setCurrentUser(null); setAuthStatus('signedOut'); setSpaces([]); setBookings([]); setDashboard(null);
    };
    window.addEventListener('trace:unauthorized', onUnauthorized);
    const token = window.sessionStorage.getItem(TOKEN_KEY);
    if (!token) setAuthStatus('signedOut');
    else request('/auth/me').then(({user}) => { setCurrentUser(user); setAuthStatus('signedIn'); }).catch(() => { window.sessionStorage.removeItem(TOKEN_KEY); setCurrentUser(null); setAuthStatus('signedOut'); });
    return () => window.removeEventListener('trace:unauthorized', onUnauthorized);
  },[]);
  useEffect(() => { if (authStatus === 'signedIn') refresh(); },[refresh,authStatus]);
  useEffect(() => { if (!toast) return; const t = setTimeout(()=>setToast(null),4500); return ()=>clearTimeout(t); },[toast]);

  const filteredBookings = useMemo(() => bookings.filter(b => {
    const q = search.toLowerCase();
    return (statusFilter === 'all' || b.status === statusFilter) && (!q || [b.reference,b.space_name,b.customer_name,b.customer_email].some(v => String(v||'').toLowerCase().includes(q)));
  }),[bookings,search,statusFilter]);
  const activeBookings = bookings.filter(b=>b.status==='confirmed');
  const upcoming = activeBookings.filter(b=>b.end_date>=today()).sort((a,b)=>a.start_date.localeCompare(b.start_date)).slice(0,5);
  const categoryCounts = useMemo(()=>spaces.reduce((acc,s)=>({...acc,[s.category]:(acc[s.category]||0)+1}),{}),[spaces]);

  const loadAvailability = useCallback(async () => {
    if (!availabilityDate || !availabilityEnd || availabilityEnd < availabilityDate) { setToast({type:'error',message:'Choose a valid date range.'}); return; }
    if (availabilityUnit==='hour' && (availabilityEnd!==availabilityDate || !Number.isInteger((timeToMinutes(availabilityEndTime)-timeToMinutes(availabilityStartTime))/60) || timeToMinutes(availabilityEndTime)<=timeToMinutes(availabilityStartTime) || timeToMinutes(availabilityEndTime)-timeToMinutes(availabilityStartTime)>720)) { setToast({type:'error',message:'Choose one date and a valid 1 to 12 hour time slot.'}); return; }
    setAvailabilityLoading(true);
    try {
      const params=new URLSearchParams({startDate:availabilityDate,endDate:availabilityUnit==='hour'?availabilityDate:availabilityEnd,category:categoryFilter,rentalUnit:availabilityUnit});
      if(availabilityUnit==='hour'){params.set('startTime',availabilityStartTime);params.set('endTime',availabilityEndTime);}
      setAvailability(await request(`/availability?${params.toString()}`));
    } catch(e) { setToast({type:'error',message:e.message}); }
    finally { setAvailabilityLoading(false); }
  },[availabilityDate,availabilityEnd,categoryFilter,availabilityUnit,availabilityStartTime,availabilityEndTime]);
  useEffect(()=>{ if(authStatus==='signedIn' && page==='Availability') loadAvailability(); },[authStatus,page,loadAvailability]);

  const notify = useCallback((type,message)=>setToast({type,message}),[]);
  const createBooking = async payload => {
    try {
      const result = await request('/bookings',{method:'POST',body:JSON.stringify(payload)});
      setBookingModal(false);
      const emailNote = result.emailStatus === 'sent'
        ? ' Confirmation email sent to the customer.'
        : result.emailStatus === 'failed'
          ? ' Booking saved, but the confirmation email failed. Check SMTP settings.'
          : ' Booking saved, but email is not configured yet.';
      notify('success',`Booking ${result.reference} created — ${currency(result.total)}.${emailNote}`);
      await refresh();
      if(page==='Availability') await loadAvailability();
    } catch(e) { notify('error',e.message); throw e; }
  };
  const cancelBooking = async booking => {
    if (!window.confirm(`Cancel booking ${booking.reference}? This releases the space for those dates.`)) return;
    try { await request(`/bookings/${booking.id}/cancel`,{method:'PATCH'}); notify('success',`Booking ${booking.reference} cancelled.`); setSelectedBooking(null); await refresh(); if(page==='Availability') await loadAvailability(); }
    catch(e) { notify('error',e.message); }
  };

  const handleLogin = ({token,user}) => {
    window.sessionStorage.setItem(TOKEN_KEY, token);
    setCurrentUser(user); setAuthStatus('signedIn'); setError('');
  };
  const handleLogout = async () => {
    try { await request('/auth/logout',{method:'POST'}); } catch { /* Clear local session even if the API is unavailable. */ }
    window.sessionStorage.removeItem(TOKEN_KEY);
    setCurrentUser(null); setAuthStatus('signedOut'); setPage('Overview');
    setSpaces([]); setBookings([]); setDashboard(null); setAvailability([]);
  };
  const handlePasswordChanged = user => setCurrentUser(user);

  const navGroups = [
    {label:'WORKSPACE',items:[['Overview',LayoutDashboard],['Bookings',CalendarCheck],['Availability',CalendarDays],['Spaces',Building2]]},
    {label:'ENGAGEMENT',items:[['Inquiries',Mail]]},
  ];
  const go = name => { setPage(name); setMobileNav(false); };

  if (window.location.pathname === '/inquiry') return <PublicInquiryPage />;
  if (authStatus === 'checking') return <AuthLoadingPage />;
  if (authStatus !== 'signedIn') return <LoginPage onLogin={handleLogin} />;

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav?'open':''}`}>
      <div className="brand"><div className="brand-mark"><span/><span/><span/></div><div className="brand-name">TRACE<span>SPACE</span></div><button className="mobile-close icon-button" onClick={()=>setMobileNav(false)}><X size={18}/></button></div>
      <div className="workspace-switch"><div className="workspace-avatar">TC</div><div className="workspace-text"><strong>TRACE Expert City</strong><span>Space management</span></div><ChevronDown size={15}/></div>
      <nav className="side-nav">{navGroups.map(group=><div className="nav-group" key={group.label}><div className="nav-label">{group.label}</div>{group.items.map(([name,Icon])=><button key={name} className={`nav-item ${page===name?'active':''}`} onClick={()=>go(name)}><Icon size={18}/><span>{name}</span>{name==='Inquiries'&&dashboard?.inquiries>0&&<span className="nav-count">{dashboard.inquiries}</span>}</button>)}</div>)}</nav>
      <div className="sidebar-bottom"><div className="help-card"><div className="help-icon"><CircleHelp size={17}/></div><strong>Need a hand?</strong><p>Keep bookings organised and spaces ready.</p><button onClick={()=>notify('info','See README.md for setup instructions and the demo workflow.')}>View quick guide <ArrowRight size={14}/></button></div><button className={`nav-item ${page==='Settings'?'active':''}`} onClick={()=>go('Settings')}><Settings size={18}/><span>Settings & setup</span></button><div className="profile-row"><div className="profile-avatar">{(currentUser?.username||'AD').slice(0,2).toUpperCase()}</div><div className="profile-text"><strong>{currentUser?.username||'Administrator'}</strong><span>{currentUser?.role||'admin'}</span></div></div></div>
    </aside>
    {mobileNav && <button className="nav-scrim" onClick={()=>setMobileNav(false)} aria-label="Close navigation"/>}
    <main className="main-area">
      <header className="topbar"><div className="topbar-left"><button className="mobile-menu icon-button" onClick={()=>setMobileNav(true)}><Menu size={20}/></button><div className="breadcrumb">Workspace <span>/</span> <strong>{page}</strong></div></div><div className="topbar-actions"><a className="public-link" href="/inquiry" target="_blank" rel="noreferrer"><ExternalLink size={14}/> Public inquiry page</a><div className="system-status"><span/> All systems operational</div><button className="icon-button notification-button" onClick={()=>go('Inquiries')} aria-label="View inquiries"><Bell size={18}/>{dashboard?.inquiries>0&&<i/>}</button><button className="logout-button" onClick={handleLogout} title="Sign out"><LogOut size={15}/><span>Sign out</span></button><div className="top-avatar">{(currentUser?.username||'AD').slice(0,2).toUpperCase()}</div></div></header>
      {error && <div className="global-error"><Activity size={17}/><span>{error}</span><Button variant="outline" icon={RefreshCw} onClick={refresh}>Retry</Button></div>}
      {page==='Overview' && <OverviewPage dashboard={dashboard} spaces={spaces} bookings={bookings} upcoming={upcoming} loading={loading} go={go} onNew={()=>setBookingModal(true)} onSelect={setSelectedBooking} categoryCounts={categoryCounts}/>}
      {page==='Bookings' && <BookingsPage bookings={filteredBookings} search={search} setSearch={setSearch} statusFilter={statusFilter} setStatusFilter={setStatusFilter} onNew={()=>setBookingModal(true)} onSelect={setSelectedBooking} loading={loading}/>}
      {page==='Availability' && <AvailabilityPage spaces={availability} start={availabilityDate} setStart={setAvailabilityDate} end={availabilityEnd} setEnd={setAvailabilityEnd} category={categoryFilter} setCategory={setCategoryFilter} rentalUnit={availabilityUnit} setRentalUnit={setAvailabilityUnit} startTime={availabilityStartTime} setStartTime={setAvailabilityStartTime} endTime={availabilityEndTime} setEndTime={setAvailabilityEndTime} loading={availabilityLoading} onCheck={loadAvailability} onNew={space=>{setBookingModal({spaceId:space?.id,rentalUnit:availabilityUnit,startDate:availabilityDate,endDate:availabilityUnit==='hour'?availabilityDate:availabilityEnd,startTime:availabilityStartTime,endTime:availabilityEndTime});}} onCalendar={setCalendarSpace}/>}
      {page==='Spaces' && <SpacesPage spaces={spaces} counts={categoryCounts} loading={loading} onBook={space=>setBookingModal({spaceId:space.id})} onCalendar={setCalendarSpace}/>}
      {page==='Inquiries' && <InquiriesPage notify={notify}/>}
      {page==='Settings' && <SettingsPage notify={notify} currentUser={currentUser} onPasswordChanged={handlePasswordChanged}/>} 
      <footer className="footer"><span>© 2026 TRACE Expert City · Space Management</span><span><span className="footer-dot"/> Booking system <b>v1.0.0</b></span></footer>
    </main>
    {calendarSpace && <SpaceCalendarModal space={calendarSpace} onClose={()=>setCalendarSpace(null)} onBook={()=>{setCalendarSpace(null);setBookingModal({spaceId:calendarSpace.id});}}/>}
    {bookingModal && <BookingModal spaces={spaces} initialSpace={bookingModal===true?null:bookingModal.spaceId} initialUnit={bookingModal===true?null:bookingModal.rentalUnit} initialStartDate={bookingModal===true?null:bookingModal.startDate} initialEndDate={bookingModal===true?null:bookingModal.endDate} initialStartTime={bookingModal===true?null:bookingModal.startTime} initialEndTime={bookingModal===true?null:bookingModal.endTime} onClose={()=>setBookingModal(false)} onSubmit={createBooking}/>}
    {inquiryModal && <InquiryModal spaces={spaces} onClose={()=>setInquiryModal(false)} notify={notify}/>}
    {selectedBooking && <BookingDetails booking={selectedBooking} onClose={()=>setSelectedBooking(null)} onCancel={cancelBooking}/>}
    {toast && <div className={`toast ${toast.type}`}><span className="toast-icon">{toast.type==='success'?<CheckCircle2 size={18}/>:toast.type==='error'?<Ban size={18}/>:<CircleHelp size={18}/>}</span><span>{toast.message}</span><button onClick={()=>setToast(null)}><X size={15}/></button></div>}
  </div>;
}

function AuthLoadingPage() {
  return <div className="auth-page"><div className="auth-card"><div className="brand-mark"><span/><span/><span/></div><h1>TRACE<span>SPACE</span></h1><p>Checking your secure session…</p><div className="table-loading"><div className="spinner"/>Loading workspace</div></div></div>;
}
function LoginPage({onLogin}) {
  const [username,setUsername]=useState('admin');
  const [password,setPassword]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const submit=async event=>{
    event.preventDefault();setError('');setBusy(true);
    try{const result=await request('/auth/login',{method:'POST',skipAuth:true,body:JSON.stringify({username,password})});onLogin(result);}
    catch(e){setError(e.message);}
    finally{setBusy(false);}
  };
  return <div className="auth-page"><div className="auth-card"><div className="auth-brand"><div className="brand-mark"><span/><span/><span/></div><div className="brand-name">TRACE<span>EXPERT CITY</span></div></div><div className="auth-kicker"><ShieldCheck size={14}/> SECURE STAFF ACCESS</div><h1>Welcome back</h1><p className="auth-subtitle">Sign in to manage spaces, bookings, and visitor inquiries.</p><form onSubmit={submit}><Field label="USERNAME" required><input autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} maxLength={80} required/></Field><Field label="PASSWORD" required><input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></Field>{error&&<div className="inline-error"><Ban size={16}/>{error}</div>}<Button type="submit" disabled={busy}>{busy?'Signing in…':'Sign in to workspace'} <ArrowRight size={15}/></Button></form><div className="auth-footnote"><LockKeyhole size={14}/> Protected administrator workspace · Sessions expire after 8 hours.</div><a className="auth-public-link" href="/inquiry">Looking to rent a space? Send an inquiry <ArrowRight size={13}/></a></div></div>;
}

function PageHeading({ eyebrow='OVERVIEW', title, description, actions }) { return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div><div className="heading-actions">{actions}</div></div>; }
function OverviewPage({dashboard,spaces,bookings,upcoming,loading,go,onNew,onSelect,categoryCounts}) {
  const [period,setPeriod] = useState('This month');
  return <div className="page-content"><PageHeading title="Good morning, Admin" description="Here’s what’s happening across your spaces today." actions={<><Button variant="outline" icon={Download} onClick={()=>exportCsv(bookings)}>Export report</Button><Button icon={Plus} onClick={onNew}>New booking</Button></>}/>
    <div className="date-banner"><div className="date-banner-icon"><CalendarDays size={18}/></div><div><strong>{new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</strong><span>Here’s your daily operations snapshot.</span></div><div className="date-banner-right"><span className="live-dot"/> LIVE OVERVIEW</div></div>
    <div className="stats-grid"><StatCard title="Total spaces" value={dashboard?.totalSpaces??spaces.length} sub="Across all space types" icon={Building2} tone="green"/><StatCard title="Available today" value={dashboard?.todayAvailable??'—'} sub="Ready to be booked" icon={CheckCircle2} tone="blue"/><StatCard title="Active bookings" value={dashboard?.activeBookings??bookings.filter(b=>b.status==='confirmed').length} sub="Confirmed reservations" icon={CalendarCheck} tone="purple"/><StatCard title="Booking revenue" value={currency(dashboard?.revenue??0)} sub="Confirmed bookings total" icon={Wallet} tone="amber"/></div>
    <div className="content-grid overview-grid"><section className="panel space-panel"><div className="panel-heading"><div><h2>Spaces at a glance</h2><p>Inventory across TRACE Expert City</p></div><button className="text-link" onClick={()=>go('Spaces')}>View all <ArrowRight size={14}/></button></div><div className="space-type-list">{Object.entries(categoryLabels).map(([key,label])=>{const Icon=categoryIcons[key];const n=categoryCounts[key]||0;return <div className="space-type-row" key={key}><div className={`space-type-icon ${key}`}><Icon size={19}/></div><div className="space-type-copy"><strong>{label}</strong><span>{key==='meeting_room'?'Rooms for meetings and training':key==='auditorium'?'Events, talks and presentations':'Flexible individual workspaces'}</span></div><div className="space-type-count"><strong>{n.toString().padStart(2,'0')}</strong><span>spaces</span></div><div className="mini-bars">{Array.from({length:Math.min(n,8)}).map((_,i)=><i key={i} className={i<n?'filled':''}/>)}</div></div>})}</div><div className="panel-bottom-note"><Sparkles size={16}/><span><strong>Good to know:</strong> Bookings are checked for date conflicts before they’re saved.</span></div></section>
      <section className="panel quick-panel"><div className="panel-heading"><div><h2>Quick actions</h2><p>Common tasks, one click away</p></div><div className="heading-dots"><MoreHorizontal size={19}/></div></div><div className="quick-action-list"><button onClick={onNew}><div className="quick-icon green"><Plus size={19}/></div><div><strong>Create a booking</strong><span>Reserve a space for a customer</span></div><ArrowRight size={16}/></button><button onClick={()=>go('Availability')}><div className="quick-icon blue"><CalendarDays size={19}/></div><div><strong>Check availability</strong><span>Find open spaces by date</span></div><ArrowRight size={16}/></button><button onClick={()=>go('Inquiries')}><div className="quick-icon amber"><Mail size={19}/></div><div><strong>Review inquiries</strong><span>Follow up on visitor requests</span></div><ArrowRight size={16}/></button></div><div className="quick-tip"><ShieldCheck size={17}/><span>Conflict protection is enabled on every booking.</span></div></section></div>
    <section className="panel upcoming-panel"><div className="panel-heading"><div><h2>Upcoming bookings</h2><p>Your next confirmed reservations</p></div><button className="text-link" onClick={()=>go('Bookings')}>All bookings <ArrowRight size={14}/></button></div><BookingTable bookings={upcoming} onSelect={onSelect} loading={loading} compact empty="No upcoming bookings yet. Create one to get started."/></section>
  </div>;
}
function BookingTable({bookings,onSelect,loading,compact=false,empty='No bookings found.'}) {
  if (loading) return <div className="table-loading"><div className="spinner"/>Loading bookings…</div>;
  if (!bookings.length) return <div className="empty-state"><div className="empty-icon"><CalendarDays size={22}/></div><strong>{empty}</strong><span>Bookings you create will appear here.</span></div>;
  return <div className="table-wrap"><table><thead><tr><th>BOOKING / CUSTOMER</th><th>SPACE</th><th>DATE & DURATION</th><th>AMOUNT</th><th>STATUS</th><th/></tr></thead><tbody>{bookings.map(b=><tr key={b.id} onClick={()=>onSelect(b)} className="click-row"><td><div className="booking-person"><div className="booking-initial">{(b.customer_name||'C').split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase()}</div><div><strong>{b.customer_name}</strong><span>{b.reference}</span></div></div></td><td><div className="space-cell"><strong>{b.space_name}</strong><span>{categoryLabels[b.category]||b.category}</span></div></td><td><div className="date-cell"><strong>{dateLabel(b.start_date)}</strong><span>{b.rental_unit==='hour'&&b.start_time&&b.end_time?`${b.start_time}–${b.end_time} · ${b.quantity} hour(s)`:b.start_date===b.end_date?'Single day':`${Math.max(1,Math.round((new Date(`${b.end_date}T00:00:00Z`)-new Date(`${b.start_date}T00:00:00Z`))/86400000)+1)} days`} · {b.rental_unit}</span></div></td><td className="amount-cell">{currency(b.total)}</td><td><StatusPill status={b.status}/></td><td><button className="row-more" onClick={e=>{e.stopPropagation();onSelect(b)}} aria-label="View booking"><MoreHorizontal size={18}/></button></td></tr>)}</tbody></table></div>;
}
function BookingsPage({bookings,search,setSearch,statusFilter,setStatusFilter,onNew,onSelect,loading}) {
  return <div className="page-content"><PageHeading eyebrow="BOOKING MANAGEMENT" title="Bookings" description="Manage reservations, customer details and booking status." actions={<Button icon={Plus} onClick={onNew}>Create booking</Button>}/><div className="panel booking-list-panel"><div className="list-toolbar"><div className="search-box"><Search size={17}/><input placeholder="Search customer, space or reference…" value={search} onChange={e=>setSearch(e.target.value)}/>{search&&<button onClick={()=>setSearch('')}><X size={14}/></button>}</div><div className="toolbar-right"><div className="filter-select"><Filter size={15}/><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="all">All statuses</option><option value="confirmed">Confirmed</option><option value="cancelled">Cancelled</option></select><ChevronDown size={14}/></div><span className="result-count">{bookings.length} records</span></div></div><BookingTable bookings={bookings} onSelect={onSelect} loading={loading}/></div><div className="hint-row"><ShieldCheck size={16}/><span>Bookings that overlap on the same space and dates are automatically rejected by the server.</span></div></div>;
}
function AvailabilityPage({spaces,start,setStart,end,setEnd,category,setCategory,rentalUnit,setRentalUnit,startTime,setStartTime,endTime,setEndTime,loading,onCheck,onNew,onCalendar}) {
  const free=spaces.filter(s=>s.available).length;
  const changeUnit=unit=>{setRentalUnit(unit);if(unit==='hour'){setEnd(start);setCategory('meeting_room');}};
  return <div className="page-content"><PageHeading eyebrow="SPACE SCHEDULING" title="Availability" description="Find the right space for the dates or hourly slot your customer needs." actions={<Button icon={Plus} onClick={()=>onNew(spaces.find(s=>s.available)||spaces[0])}>New booking</Button>}/><section className="panel availability-filter-panel"><div className="filter-title"><div className="filter-symbol"><SlidersHorizontal size={18}/></div><div><h2>Find available spaces</h2><p>Choose a date range or a specific hourly slot for meeting rooms.</p></div></div><div className="availability-fields"><Field label="START DATE" required><input type="date" min={today()} value={start} onChange={e=>{setStart(e.target.value);if(rentalUnit==='hour'||end<e.target.value)setEnd(e.target.value)}}/></Field>{rentalUnit!=='hour'&&<Field label="END DATE" required><input type="date" min={start||today()} value={end} onChange={e=>setEnd(e.target.value)}/></Field>}<Field label="SPACE TYPE"><select value={category} onChange={e=>{setCategory(e.target.value);if(e.target.value!=='meeting_room'&&rentalUnit==='hour')setRentalUnit('day');}}><option value="all">All space types</option><option value="meeting_room">Meeting & training rooms</option><option value="auditorium">Auditorium</option><option value="coworking_desk">Co-working desks</option></select></Field><Field label="BOOKING TYPE"><select value={rentalUnit} onChange={e=>changeUnit(e.target.value)}><option value="day">Full-day / date range</option><option value="hour">Hourly time slot</option></select></Field>{rentalUnit==='hour'&&<><Field label="START TIME" required><input type="time" step="3600" value={startTime} onChange={e=>setStartTime(e.target.value)} required/></Field><Field label="END TIME" required><input type="time" step="3600" value={endTime} onChange={e=>setEndTime(e.target.value)} required/></Field></>}<Button icon={Search} onClick={onCheck} disabled={loading}>{loading?'Checking…':'Check availability'}</Button></div></section><div className="availability-summary"><div><span className="live-dot"/><strong>{free} spaces available</strong><span>for {dateLabel(start)}{rentalUnit!=='hour'&&end!==start?` – ${dateLabel(end)}`:''}{rentalUnit==='hour'?` · ${startTime}–${endTime}`:''}</span></div><span className="result-count">{spaces.length} spaces checked</span></div><div className="space-card-grid">{loading?<div className="loading-card"><div className="spinner"/>Checking spaces…</div>:spaces.map(space=><SpaceCard key={space.id} space={space} available={space.available} onBook={()=>onNew(space)} onCalendar={()=>onCalendar(space)}/>)}</div>{!loading&&spaces.length===0&&<div className="empty-state"><strong>No spaces match those filters.</strong><span>Try another date or space type.</span></div>}<div className="hint-row"><ShieldCheck size={16}/><span>{rentalUnit==='hour'?'Only meeting rooms with a free matching time slot are marked available. The server rechecks the slot before saving.':'Date-range search checks for any confirmed booking on the requested dates. The server rechecks availability before saving.'}</span></div></div>;
}
function SpaceCard({space,available=true,onBook,onCalendar}) {
  const Icon=categoryIcons[space.category]||Building2;
  return <article className={`space-card ${!available?'unavailable':''}`}><div className={`space-card-art ${space.category}`}><div className="art-grid"/><div className="art-icon"><Icon size={32}/></div><div className="art-tag">{categoryLabels[space.category]}</div><div className="art-capacity"><Users size={14}/>{space.capacity} {space.capacity===1?'person':'people'}</div></div><div className="space-card-body"><div className="space-card-title"><h3>{space.name}</h3><StatusPill status={available?'available':'booked'}/></div><p>{space.description}</p><div className="amenity-list">{space.amenities.slice(0,3).map(a=><span key={a}>{a}</span>)}{space.amenities.length>3&&<span>+{space.amenities.length-3}</span>}</div><div className="space-card-footer"><div><strong>{currency(space.rate)}</strong><span>/ {space.rate_unit}</span></div><div className="space-card-actions"><Button variant="outline" icon={Calendar} onClick={onCalendar}>Calendar</Button><Button variant={available?'primary':'outline'} disabled={!available} onClick={onBook}>{available?'Book space':'Unavailable'}</Button></div></div></div></article>;
}
function SpacesPage({spaces,counts,loading,onBook,onCalendar}) {
  const [filter,setFilter]=useState('all');
  const visible=spaces.filter(s=>filter==='all'||s.category===filter);
  return <div className="page-content"><PageHeading eyebrow="SPACE DIRECTORY" title="Spaces & rates" description="Your bookable rooms, event venues and flexible desks in one place." actions={<Button variant="outline" icon={Download} onClick={()=>exportCsv(spaces,'trace-spaces.csv')}>Export spaces</Button>}/><div className="inventory-summary"><div><span className="inventory-number">{spaces.length.toString().padStart(2,'0')}</span><span>Total active spaces</span></div><div className="inventory-divider"/>{Object.entries(categoryLabels).map(([k,v])=><div key={k}><strong>{counts[k]||0}</strong><span>{v}</span></div>)}</div><div className="section-toolbar"><div className="filter-tabs">{[['all','All spaces'],['meeting_room','Meeting rooms'],['auditorium','Auditorium'],['coworking_desk','Co-working']].map(([v,l])=><button key={v} className={filter===v?'active':''} onClick={()=>setFilter(v)}>{l}<span>{v==='all'?spaces.length:counts[v]||0}</span></button>)}</div></div>{loading?<div className="table-loading"><div className="spinner"/>Loading spaces…</div>:<div className="space-card-grid">{visible.map(s=><SpaceCard key={s.id} space={s} available onBook={()=>onBook(s)} onCalendar={()=>onCalendar(s)}/>)}</div>}</div>;
}
function SpaceCalendarModal({space,onClose,onBook}) {
  const [month,setMonth] = useState(()=>new Date(new Date().getFullYear(),new Date().getMonth(),1));
  const [bookings,setBookings] = useState([]);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const year=month.getFullYear(); const monthIndex=month.getMonth();
  const monthKey=`${year}-${String(monthIndex+1).padStart(2,'0')}`;
  const monthTitle=month.toLocaleDateString('en-US',{month:'long',year:'numeric'});
  useEffect(()=>{let live=true;setLoading(true);setError('');request(`/spaces/${space.id}/calendar?month=${monthKey}`).then(data=>{if(live)setBookings(data.bookings||[]);}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[space.id,monthKey]);
  const firstDay=new Date(year,monthIndex,1).getDay();
  const daysInMonth=new Date(year,monthIndex+1,0).getDate();
  const cells=[...Array(firstDay).fill(null),...Array.from({length:daysInMonth},(_,i)=>i+1)];
  const isoDay=day=>`${year}-${String(monthIndex+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const bookingsFor=day=>bookings.filter(b=>b.start_date<=isoDay(day)&&b.end_date>=isoDay(day));
  const fullDayBooking=day=>bookingsFor(day).find(b=>b.rental_unit!=='hour'||!b.start_time||!b.end_time);
  const hourlyBooking=day=>bookingsFor(day).find(b=>b.rental_unit==='hour'&&b.start_time&&b.end_time);
  const todayKey=today();
  return <Modal title={space.name} subtitle={`Availability calendar · ${categoryLabels[space.category]}`} onClose={onClose} wide>
    <div className="calendar-modal-toolbar"><div><strong>{monthTitle}</strong><span>Red dates are fully booked. Green dates with 'Time slots' contain an hourly reservation.</span></div><div className="calendar-month-nav"><button className="icon-button" aria-label="Previous month" onClick={()=>setMonth(new Date(year,monthIndex-1,1))}><ChevronLeft size={18}/></button><button className="icon-button" aria-label="Next month" onClick={()=>setMonth(new Date(year,monthIndex+1,1))}><ChevronRight size={18}/></button></div></div>
    <div className="calendar-legend"><span><i className="calendar-dot free"/> Available</span><span><i className="calendar-dot booked"/> Booked</span><span><i className="calendar-dot past"/> Past date</span></div>
    {error?<div className="inline-error"><Ban size={16}/>{error}</div>:<div className="availability-calendar" aria-label={`${monthTitle} availability calendar`}>
      {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day=><div className="calendar-weekday" key={day}>{day}</div>)}
      {cells.map((day,index)=>{if(!day)return <div className="calendar-empty" key={`empty-${index}`}/>;const booked=fullDayBooking(day);const hourly=hourlyBooking(day);const date=isoDay(day);const past=date<todayKey;const title=booked?`Booked: ${booked.reference}`:hourly?`Hourly reservation ${hourly.start_time}–${hourly.end_time}; other times may be available`:past?'Past date':'Available';return <div key={date} className={`calendar-day ${booked?'is-booked':past?'is-past':'is-free'} ${date===todayKey?'is-today':''}`} title={title}><strong>{day}</strong>{booked&&<small>Booked</small>}{!booked&&hourly&&!past&&<small>Time slots</small>}{!booked&&!hourly&&!past&&<small>Available</small>}{date===todayKey&&<em>Today</em>}</div>;})}
    </div>}
    {loading&&<div className="calendar-loading"><span className="spinner"/>Loading current bookings…</div>}
    {!loading&&!error&&<div className="calendar-booking-summary"><CalendarDays size={16}/><span>{bookings.length} confirmed booking{bookings.length===1?'':'s'} overlap this month. Hourly reservations can leave other times available.</span></div>}
    <div className="modal-actions"><Button variant="outline" onClick={onClose}>Close calendar</Button><Button icon={CalendarCheck} onClick={onBook}>Create booking</Button></div>
  </Modal>;
}

function BookingModal({spaces,initialSpace,initialUnit,initialStartDate,initialEndDate,initialStartTime,initialEndTime,onClose,onSubmit}) {
  const [form,setForm]=useState({spaceId:initialSpace?String(initialSpace):'',customerName:'',customerEmail:'',customerPhone:'',startDate:initialStartDate||today(),endDate:initialUnit==='hour'?(initialStartDate||today()):(initialEndDate||initialStartDate||today()),startTime:initialStartTime||'09:00',endTime:initialEndTime||'11:00',rentalUnit:initialUnit||'day',quantity:1,notes:''});
  const [busy,setBusy]=useState(false); const [localError,setLocalError]=useState('');
  const space=spaces.find(s=>s.id===Number(form.spaceId));
  useEffect(()=>{
    if(!space)return;
    let unit=form.rentalUnit;
    if(space.category==='meeting_room'&&!['hour','day'].includes(unit))unit='day';
    if(space.category==='auditorium')unit='day';
    if(space.category==='coworking_desk'&&!['day','week','month'].includes(unit))unit='day';
    if(unit!==form.rentalUnit)setForm(f=>({...f,rentalUnit:unit,quantity:1,endDate:unit==='hour'?f.startDate:f.endDate}));
  },[space?.id]);
  const set=(key,value)=>setForm(f=>({...f,[key]:value}));
  const days=Math.max(1,Math.floor((new Date(`${form.endDate}T00:00:00Z`)-new Date(`${form.startDate}T00:00:00Z`))/86400000)+1);
  const baseRate=space?Number(space.rate):0;
  const rate=space?(form.rentalUnit==='day'&&space.category==='meeting_room'?baseRate*8:form.rentalUnit==='week'?baseRate*7:form.rentalUnit==='month'?baseRate*30:baseRate):0;
  const durationMinutes=timeToMinutes(form.endTime)-timeToMinutes(form.startTime);
  const hours=durationMinutes/60;
  const total=space?(form.rentalUnit==='hour'?rate*(Number.isFinite(hours)&&hours>0?hours:0):form.rentalUnit==='day'?rate*days:form.rentalUnit==='week'?rate*Math.ceil(days/7):rate*Math.ceil(days/30)):0;
  const setUnit=unit=>setForm(f=>({...f,rentalUnit:unit,quantity:unit==='hour'?2:1,endDate:unit==='hour'?f.startDate:f.endDate}));
  const submit=async e=>{
    e.preventDefault();setLocalError('');
    if(!space){setLocalError('Choose a space to book.');return;}
    if(!form.startDate||!form.endDate||form.endDate<form.startDate){setLocalError('Choose a valid start and end date.');return;}
    if(form.rentalUnit==='hour'&&(form.endDate!==form.startDate||!Number.isInteger(hours)||hours<1||hours>12)){setLocalError('Hourly bookings need one date and a duration of 1 to 12 whole hours.');return;}
    setBusy(true);
    try{await onSubmit({...form,spaceId:Number(form.spaceId),quantity:form.rentalUnit==='hour'?hours:1,startTime:form.rentalUnit==='hour'?form.startTime:null,endTime:form.rentalUnit==='hour'?form.endTime:null});}
    catch(e){setLocalError(e.message);}finally{setBusy(false);}
  };
  return <Modal title="Create a booking" subtitle="Add the customer and reservation details below." onClose={onClose} wide><form onSubmit={submit}>
    <div className="form-section-title"><span>01</span><div><strong>Space & schedule</strong><small>Choose the space and requested dates.</small></div></div>
    <div className="form-grid">
      <Field label="SPACE" required><select value={form.spaceId} onChange={e=>set('spaceId',e.target.value)} required><option value="">Select a space…</option>{spaces.map(s=><option key={s.id} value={s.id}>{s.name} · {categoryLabels[s.category]}</option>)}</select></Field>
      <Field label="RENTAL UNIT" required><select value={form.rentalUnit} onChange={e=>setUnit(e.target.value)} disabled={space?.category==='auditorium'}><option value="hour" disabled={space?.category!=='meeting_room'}>Hourly</option><option value="day">Daily</option><option value="week" disabled={space?.category!=='coworking_desk'}>Weekly (desks)</option><option value="month" disabled={space?.category!=='coworking_desk'}>Monthly (desks)</option></select></Field>
      <Field label={form.rentalUnit==='hour'?'BOOKING DATE':'START DATE'} required><input type="date" min={today()} value={form.startDate} onChange={e=>setForm(f=>({...f,startDate:e.target.value,endDate:f.rentalUnit==='hour'||f.endDate<e.target.value?e.target.value:f.endDate}))} required/></Field>
      {form.rentalUnit!=='hour'&&<Field label="END DATE" required><input type="date" min={form.startDate} value={form.endDate} onChange={e=>set('endDate',e.target.value)} required/></Field>}
      {form.rentalUnit==='hour'&&<><Field label="START TIME" required><input type="time" step="3600" value={form.startTime} onChange={e=>set('startTime',e.target.value)} required/></Field><Field label="END TIME" required><input type="time" step="3600" value={form.endTime} onChange={e=>set('endTime',e.target.value)} required/></Field></>}
    </div>
    <div className="form-section-title separated"><span>02</span><div><strong>Customer details</strong><small>Who is this booking for?</small></div></div>
    <div className="form-grid"><Field label="FULL NAME" required><input value={form.customerName} onChange={e=>set('customerName',e.target.value)} placeholder="e.g. Nimal Perera" maxLength={120} required/></Field><Field label="EMAIL ADDRESS" required><input type="email" value={form.customerEmail} onChange={e=>set('customerEmail',e.target.value)} placeholder="name@company.com" maxLength={254} required/></Field><Field label="PHONE NUMBER"><input type="tel" value={form.customerPhone} onChange={e=>set('customerPhone',e.target.value)} placeholder="+94 7X XXX XXXX" maxLength={60}/></Field><Field label="INTERNAL NOTES"><input value={form.notes} onChange={e=>set('notes',e.target.value)} placeholder="Optional notes for the team" maxLength={1000}/></Field></div>
    {space&&<div className="price-summary"><div className="price-summary-top"><div><span>ESTIMATED TOTAL</span><small>{currency(rate)} / {form.rentalUnit}{form.rentalUnit==='hour'?'':form.rentalUnit==='week'?' · 7-day block':form.rentalUnit==='month'?' · 30-day block':` · ${days} calendar day${days===1?'':'s'}`}</small></div><strong>{currency(total)}</strong></div><div className="price-breakdown"><span>{form.rentalUnit==='hour'?`${Number.isFinite(hours)&&hours>0?hours:0} hour${hours===1?'':'s'} · ${form.startTime}–${form.endTime}`:form.rentalUnit==='day'?`${days} day${days===1?'':'s'}`:form.rentalUnit==='week'?`${Math.ceil(days/7)} week block(s)`:`${Math.ceil(days/30)} month block(s)`}</span><span>{currency(total)}</span></div></div>}
    {localError&&<div className="inline-error"><Ban size={16}/>{localError}</div>}
    <div className="modal-actions"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" icon={Check} disabled={busy}>{busy?'Saving booking…':'Confirm booking'}</Button></div><p className="form-footnote"><ShieldCheck size={14}/> The server validates dates, time-slot conflicts, and the final price before saving.</p>
  </form></Modal>;
}
function BookingDetails({booking,onClose,onCancel}) {
  return <Modal title="Booking details" subtitle={booking.reference} onClose={onClose}><div className="detail-status-row"><StatusPill status={booking.status}/><span className="detail-created">Created {dateLabel(booking.created_at?.slice(0,10))}</span></div><div className="detail-price"><span>Total booking value</span><strong>{currency(booking.total)}</strong><small>{currency(booking.rate)} per {booking.rental_unit}</small></div><div className="detail-list"><div><span><Building2 size={16}/> Space</span><strong>{booking.space_name}</strong></div><div><span><CalendarDays size={16}/> Dates</span><strong>{dateLabel(booking.start_date)}{booking.end_date!==booking.start_date?` – ${dateLabel(booking.end_date)}`:''}{booking.rental_unit==='hour'&&booking.start_time&&booking.end_time?` · ${booking.start_time}–${booking.end_time}`:''}</strong></div><div><span><Users size={16}/> Customer</span><strong>{booking.customer_name}</strong></div><div><span><Mail size={16}/> Email</span><strong>{booking.customer_email}</strong></div>{booking.customer_phone&&<div><span><Activity size={16}/> Phone</span><strong>{booking.customer_phone}</strong></div>}{booking.notes&&<div><span><ClipboardList size={16}/> Notes</span><strong>{booking.notes}</strong></div>}</div>{booking.status==='confirmed'&&<div className="modal-actions"><Button variant="outline" onClick={onClose}>Close</Button><Button variant="danger" icon={X} onClick={()=>onCancel(booking)}>Cancel booking</Button></div>}{booking.status==='cancelled'&&<div className="modal-actions"><Button onClick={onClose}>Done</Button></div>}</Modal>;
}
function InquiryModal({spaces,onClose,notify}) {
  const [form,setForm]=useState({name:'',email:'',phone:'',spaceId:'',startDate:today(),endDate:today(),rentalUnit:'day',message:''}); const [busy,setBusy]=useState(false);
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const submit=async e=>{e.preventDefault();setBusy(true);try{const r=await request('/inquiries',{method:'POST',body:JSON.stringify(form)});notify('success',r.message);onClose();}catch(e){notify('error',e.message);}finally{setBusy(false);}};
  return <Modal title="Send a public inquiry" subtitle="A visitor can ask about a space without making a booking." onClose={onClose} wide><form onSubmit={submit}><div className="form-grid"><Field label="FULL NAME" required><input value={form.name} onChange={e=>set('name',e.target.value)} required/></Field><Field label="EMAIL ADDRESS" required><input type="email" value={form.email} onChange={e=>set('email',e.target.value)} required/></Field><Field label="PHONE NUMBER"><input value={form.phone} onChange={e=>set('phone',e.target.value)}/></Field><Field label="SPACE OF INTEREST"><select value={form.spaceId} onChange={e=>set('spaceId',e.target.value)}><option value="">Not sure yet</option>{spaces.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></Field><Field label="START DATE"><input type="date" value={form.startDate} onChange={e=>set('startDate',e.target.value)}/></Field><Field label="END DATE"><input type="date" min={form.startDate} value={form.endDate} onChange={e=>set('endDate',e.target.value)}/></Field><Field label="DESK RENTAL PERIOD"><select value={form.rentalUnit} onChange={e=>set('rentalUnit',e.target.value)}><option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option><option value="hour">Hourly</option></select></Field><Field label="MESSAGE" required><input value={form.message} onChange={e=>set('message',e.target.value)} placeholder="Tell us about your requirements…" required/></Field></div><div className="modal-actions"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" icon={Send} disabled={busy}>{busy?'Sending…':'Submit inquiry'}</Button></div></form></Modal>;
}
function InquiriesPage({notify}) {
  const [items,setItems]=useState([]); const [loading,setLoading]=useState(true); const [spaces,setSpaces]=useState([]); const [modal,setModal]=useState(false);
  const load=useCallback(async()=>{setLoading(true);try{const [i,s]=await Promise.all([request('/inquiries'),request('/spaces')]);setItems(i);setSpaces(s);}catch(e){notify('error',e.message);}finally{setLoading(false);}},[notify]);
  useEffect(()=>{load();},[load]);
  return <div className="page-content"><PageHeading eyebrow="VISITOR ENGAGEMENT" title="Inquiries" description="Review visitor requests and follow up to turn interest into bookings." actions={<Button icon={Plus} onClick={()=>setModal(true)}>New inquiry</Button>}/><div className="inquiry-callout"><div className="inquiry-callout-icon"><Mail size={21}/></div><div><strong>Request-to-book workflow</strong><p>Visitors send an inquiry; the team checks availability and creates the confirmed booking here. No public self-service bookings or payments.</p></div><div className="callout-step"><span>01</span> Inquiry <ArrowRight size={13}/><span>02</span> Follow up <ArrowRight size={13}/><span>03</span> Booking</div></div><div className="panel inquiry-panel"><div className="panel-heading"><div><h2>Visitor requests</h2><p>{items.length} inquiry record{items.length===1?'':'s'}</p></div><Button variant="outline" icon={RefreshCw} onClick={load}>Refresh</Button></div>{loading?<div className="table-loading"><div className="spinner"/>Loading inquiries…</div>:!items.length?<div className="empty-state"><div className="empty-icon"><Mail size={22}/></div><strong>No inquiries yet</strong><span>New public requests will be listed here.</span><Button variant="outline" icon={Plus} onClick={()=>setModal(true)}>Create test inquiry</Button></div>:<div className="inquiry-list">{items.map(i=><article className="inquiry-item" key={i.id}><div className="inquiry-avatar">{i.name.split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase()}</div><div className="inquiry-main"><div className="inquiry-title-row"><strong>{i.name}</strong><span className="inquiry-date">{dateLabel(i.created_at?.slice(0,10))}</span></div><div className="inquiry-contact">{i.email}{i.phone?` · ${i.phone}`:''}</div><p>{i.message}</p><div className="inquiry-meta"><span><Building2 size={13}/>{i.space_name||'Space not specified'}</span>{i.start_date&&<span><CalendarDays size={13}/>{dateLabel(i.start_date)}{i.end_date&&i.end_date!==i.start_date?` – ${dateLabel(i.end_date)}`:''}</span>}<span className="unit-label">{i.rental_unit}</span></div></div><a className="reply-link" href={`mailto:${encodeURIComponent(i.email)}?subject=${encodeURIComponent('TRACE Expert City space inquiry')}`}><Mail size={14}/> Reply</a></article>)}</div>}</div>{modal&&<InquiryModal spaces={spaces} onClose={()=>setModal(false)} notify={msg=>{notify('success',msg);load();}}/>}</div>;
}
function SettingsPage({notify,currentUser,onPasswordChanged}) {
  const [api,setApi]=useState('Checking…');
  useEffect(()=>{request('/health').then(r=>setApi(r.status==='ok'?'Connected':'Unavailable')).catch(()=>setApi('Unavailable'));},[]);
  return <div className="page-content"><PageHeading eyebrow="SYSTEM CONFIGURATION" title="Settings & setup" description="Application health, email setup and operational notes."/><div className="settings-grid"><section className="panel settings-panel"><div className="settings-section-heading"><div className="settings-icon green"><Activity size={19}/></div><div><h2>System status</h2><p>Current application connectivity</p></div></div><div className="settings-row"><div><strong>Backend API</strong><span>Node.js + Express · Port 4000</span></div><StatusPill status={api==='Connected'?'available':'booked'}/></div><div className="settings-row"><div><strong>Database</strong><span>SQLite · Local persistent storage</span></div><StatusPill status="available"/></div><div className="settings-row"><div><strong>Conflict protection</strong><span>Atomic server-side booking transaction</span></div><StatusPill status="available"/></div><Button variant="outline" icon={RefreshCw} onClick={()=>request('/health').then(()=>{setApi('Connected');notify('success','API health check passed.');}).catch(()=>{setApi('Unavailable');notify('error','API could not be reached.');})}>Run health check</Button></section><section className="panel settings-panel"><div className="settings-section-heading"><div className="settings-icon amber"><Mail size={19}/></div><div><h2>Email notifications</h2><p>SMTP is configured through environment variables for booking confirmations and inquiry notifications.</p></div></div><div className="email-steps"><div><span>01</span><p>Copy <code>server/.env.example</code> to <code>server/.env</code>.</p></div><div><span>02</span><p>Set <code>ADMIN_EMAIL</code>, <code>SMTP_HOST</code>, <code>SMTP_PORT</code>, <code>SMTP_SECURE</code>, <code>SMTP_USER</code>, <code>SMTP_PASS</code> and <code>SMTP_FROM</code>.</p></div><div><span>03</span><p>Restart the API. Booking confirmations go to customers; inquiry notifications go to the configured administrator.</p></div></div><div className="settings-note"><CircleHelp size={16}/><span>If SMTP is not configured, bookings and inquiries are still saved; the app reports that an email was not sent.</span></div></section><section className="panel settings-panel"><div className="settings-section-heading"><div className="settings-icon blue"><CircleDollarSign size={19}/></div><div><h2>Pricing rules</h2><p>Rates are seeded for demonstration and can be updated in SQLite.</p></div></div><ul className="rules-list"><li>Meeting and training rooms: hourly or daily.</li><li>Auditorium: daily rate.</li><li>Co-working desks: daily, weekly (7-day blocks), or monthly (30-day blocks).</li><li>Date ranges are inclusive; the start and end dates are both billed.</li></ul></section><section className="panel settings-panel"><div className="settings-section-heading"><div className="settings-icon purple"><ShieldCheck size={19}/></div><div><h2>Production checklist</h2><p>Before using real customer data.</p></div></div><div className="checklist"><div><CheckCircle2 size={17}/><span>Booking overlap validation on server</span></div><div><CheckCircle2 size={17}/><span>Persistent local database and input validation</span></div><div><CheckCircle2 size={17}/><span>Admin authentication and protected API routes</span></div><div><CircleHelp size={17}/><span>Configure production SMTP and HTTPS</span></div><div><CircleHelp size={17}/><span>Back up database and review privacy requirements</span></div></div></section><PasswordChangePanel currentUser={currentUser} onPasswordChanged={onPasswordChanged} notify={notify}/></div><div className="hint-row"><ExternalLink size={15}/><span>For complete install commands and the 90-second demo flow, see the project README.md.</span></div></div>;
}
function PasswordChangePanel({currentUser,onPasswordChanged,notify}) {
  const [currentPassword,setCurrentPassword]=useState('');
  const [newPassword,setNewPassword]=useState('');
  const [confirmPassword,setConfirmPassword]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const submit=async event=>{
    event.preventDefault();setError('');
    if(newPassword.length<12){setError('Use at least 12 characters for your new password.');return;}
    if(newPassword!==confirmPassword){setError('The new password and confirmation do not match.');return;}
    setBusy(true);
    try{
      const result=await request('/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword,newPassword})});
      window.sessionStorage.setItem(TOKEN_KEY,result.token);
      onPasswordChanged(result.user);setCurrentPassword('');setNewPassword('');setConfirmPassword('');notify('success',result.message);
    }catch(e){setError(e.message);}finally{setBusy(false);}
  };
  return <section className="panel settings-panel password-panel"><div className="settings-section-heading"><div className="settings-icon purple"><KeyRound size={19}/></div><div><h2>Account security</h2><p>Signed in as {currentUser?.username||'administrator'}. Change your password regularly.</p></div></div><form className="password-change-form" onSubmit={submit}><Field label="CURRENT PASSWORD" required><input type="password" autoComplete="current-password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} required/></Field><Field label="NEW PASSWORD" required hint="At least 12 characters."><input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={newPassword} onChange={e=>setNewPassword(e.target.value)} required/></Field><Field label="CONFIRM NEW PASSWORD" required><input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} required/></Field>{error&&<div className="inline-error"><Ban size={16}/>{error}</div>}<Button type="submit" icon={KeyRound} disabled={busy}>{busy?'Updating password…':'Update password'}</Button></form></section>;
}

function PublicInquiryPage() {
  const [spaces,setSpaces]=useState([]);
  const [form,setForm]=useState({name:'',email:'',phone:'',spaceId:'',startDate:'',endDate:'',rentalUnit:'day',message:''});
  const [busy,setBusy]=useState(false); const [result,setResult]=useState(null); const [error,setError]=useState('');
  useEffect(()=>{request('/spaces').then(setSpaces).catch(e=>setError(`Could not load spaces: ${e.message}`));},[]);
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const submit=async e=>{e.preventDefault();setBusy(true);setError('');setResult(null);try{const r=await request('/inquiries',{method:'POST',body:JSON.stringify(form)});setResult(r);setForm({name:'',email:'',phone:'',spaceId:'',startDate:'',endDate:'',rentalUnit:'day',message:''});}catch(e){setError(e.message);}finally{setBusy(false);}};
  return <div className="public-page"><header className="public-header"><a href="/" className="public-brand"><div className="brand-mark"><span/><span/><span/></div><div className="brand-name">TRACE<span>EXPERT CITY</span></div></a><div className="public-header-note"><MapPin size={14}/> Colombo, Sri Lanka</div></header><main className="public-main"><div className="public-intro"><div className="public-kicker"><Sparkles size={14}/> SPACE RENTAL ENQUIRIES</div><h1>Find your space.<br/><span>Make it happen.</span></h1><p>From focused team meetings to large-scale events and flexible co-working, tell us what you need. Our team will check availability and get back to you.</p><div className="public-benefits"><span><CheckCircle2 size={15}/> Personal follow-up</span><span><CheckCircle2 size={15}/> No payment required</span><span><CheckCircle2 size={15}/> Flexible spaces</span></div><div className="public-art"><div className="public-art-circle circle-one"/><div className="public-art-circle circle-two"/><div className="public-art-building"><div className="building-roof"/><div className="building-floors"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></div><div className="building-base"/></div><div className="public-art-label"><Building2 size={17}/><div><strong>TRACE Expert City</strong><span>Spaces built for ideas</span></div></div></div></div><section className="public-form-card"><div className="public-form-head"><div className="public-form-icon"><Mail size={20}/></div><div><h2>Tell us what you need</h2><p>Fill in the form and our team will follow up with you.</p></div></div>{result?<div className="public-success"><div className="public-success-icon"><CheckCircle2 size={26}/></div><h3>Thanks for your inquiry!</h3><p>{result.message}</p><button className="button outline" onClick={()=>setResult(null)}>Send another inquiry</button></div>:<form onSubmit={submit}><div className="form-grid"><Field label="YOUR NAME" required><input value={form.name} onChange={e=>set('name',e.target.value)} placeholder="Full name" required/></Field><Field label="EMAIL ADDRESS" required><input type="email" value={form.email} onChange={e=>set('email',e.target.value)} placeholder="you@example.com" required/></Field><Field label="PHONE NUMBER"><input type="tel" value={form.phone} onChange={e=>set('phone',e.target.value)} placeholder="+94 7X XXX XXXX"/></Field><Field label="SPACE OF INTEREST"><select value={form.spaceId} onChange={e=>set('spaceId',e.target.value)}><option value="">Not sure yet</option>{spaces.map(s=><option key={s.id} value={s.id}>{s.name} — {categoryLabels[s.category]}</option>)}</select></Field><Field label="START DATE"><input type="date" min={today()} value={form.startDate} onChange={e=>{set('startDate',e.target.value);if(form.endDate&&form.endDate<e.target.value)set('endDate',e.target.value)}}/></Field><Field label="END DATE"><input type="date" min={form.startDate||today()} value={form.endDate} onChange={e=>set('endDate',e.target.value)}/></Field><Field label="RENTAL PERIOD"><select value={form.rentalUnit} onChange={e=>set('rentalUnit',e.target.value)}><option value="hour">Hourly</option><option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option></select></Field><Field label="YOUR MESSAGE" required><input value={form.message} onChange={e=>set('message',e.target.value)} placeholder="Number of people, setup or questions…" required/></Field></div>{error&&<div className="inline-error"><Ban size={16}/>{error}</div>}<div className="public-submit"><Button type="submit" icon={Send} disabled={busy}>{busy?'Submitting…':'Send inquiry'}</Button><span><ShieldCheck size={14}/> Your request goes to our space team.</span></div><p className="public-disclaimer">Submitting an inquiry does not confirm a booking. Our team will contact you to confirm availability.</p></form>}</section></main><footer className="public-footer"><span>© 2026 TRACE Expert City</span><a href="/">Staff? Open booking dashboard <ArrowRight size={13}/></a></footer></div>;
}

function exportCsv(rows,filename='trace-bookings.csv') {
  if(!rows.length)return;const keys=Object.keys(rows[0]);const esc=v=>`"${String(Array.isArray(v)?v.join(', '):v??'').replaceAll('"','""')}"`;const csv=[keys.map(esc).join(','),...rows.map(r=>keys.map(k=>esc(r[k])).join(','))].join('\r\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);
}
