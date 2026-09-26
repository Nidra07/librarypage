'use client'

import { useState } from 'react'
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  Clock3,
  Camera,
  Library,
  MapPin,
  Menu,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react'

const seats = [
  { label: 'A01', state: 'available' },
  { label: 'A02', state: 'available' },
  { label: 'A03', state: 'booked' },
  { label: 'A04', state: 'available' },
  { label: 'A05', state: 'reserved' },
  { label: 'A06', state: 'available' },
  { label: 'B01', state: 'available' },
  { label: 'B02', state: 'maintenance' },
  { label: 'B03', state: 'available' },
  { label: 'B04', state: 'booked' },
  { label: 'B05', state: 'available' },
  { label: 'B06', state: 'available' },
]

const plans = [
  { name: 'Flexi Day', price: '₹120', detail: 'Per day', featured: false },
  { name: 'Monthly Focus', price: '₹1,499', detail: 'Per month', featured: true },
  { name: 'Deep Work', price: '₹3,999', detail: '3 months', featured: false },
]

export default function Page() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [selectedSeat, setSelectedSeat] = useState('A04')
  const [activePlan, setActivePlan] = useState('Monthly Focus')
  const [toast, setToast] = useState('')

  function showToast(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(''), 2800)
  }

  return (
    <main className="site-shell">
      <header className="site-header">
        <a href="#home" className="brand" aria-label="The Peaceful Pages Library home">
          <span className="brand-mark"><BookOpen /></span>
          <span><strong>The Peaceful Pages</strong><small>LIBRARY</small></span>
        </a>
        <button className="menu-toggle" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle navigation">
          {menuOpen ? <X /> : <Menu />}
        </button>
        <nav className={menuOpen ? 'main-nav open' : 'main-nav'}>
          <a href="#about" onClick={() => setMenuOpen(false)}>About</a>
          <a href="#facilities" onClick={() => setMenuOpen(false)}>Facilities</a>
          <a href="#seats" onClick={() => setMenuOpen(false)}>Study Seats</a>
          <a href="#pricing" onClick={() => setMenuOpen(false)}>Pricing</a>
          <a href="#contact" onClick={() => setMenuOpen(false)}>Contact</a>
          <a className="nav-login" href="/auth/login">Student Login <ArrowRight /></a>
        </nav>
      </header>

      <section className="hero" id="home">
        <div className="hero-copy">
          <div className="eyebrow"><Sparkles /> A calmer way to study</div>
          <h1>Your space to<br /><em>read, relax,</em> and rise.</h1>
          <p>Find your focus in a thoughtfully designed library made for ambitious minds. Quiet corners, reliable Wi-Fi, and a seat that feels like yours.</p>
          <div className="hero-actions">
            <a href="#seats" className="primary-button">Book a study seat <ArrowRight /></a>
            <a href="#about" className="text-button">Discover the library <ArrowRight /></a>
          </div>
          <div className="hero-proof"><div className="avatar-stack"><span>AS</span><span>RK</span><span>PM</span><span>+</span></div><span><strong>500+ focused minds</strong><br />call Peaceful Pages home</span></div>
        </div>
        <div className="hero-visual" aria-label="Library reading room">
          <div className="hero-image"><div className="sun-glow" /><div className="window-line one" /><div className="window-line two" /><div className="bookshelf"><i /><i /><i /><i /><i /><i /></div><div className="reading-table"><span /><span /><span /></div><div className="plant"><b /><i /><i /><i /></div></div>
          <div className="floating-note"><span className="status-dot" /><div><strong>Open today</strong><small>06:00 AM — 11:00 PM</small></div><Clock3 /></div>
          <div className="hero-caption"><span>01</span><div><strong>A quiet place to do your best work.</strong><small>Designed for deep focus.</small></div></div>
        </div>
      </section>

      <section className="stats-strip" id="about">
        <div><strong>6 AM — 11 PM</strong><span>Open every day</span></div><div><strong>80+</strong><span>Dedicated study seats</span></div><div><strong>100 Mbps</strong><span>Fast, stable Wi-Fi</span></div><div><strong>4.9 / 5</strong><span>Member experience</span></div>
      </section>

      <section className="section facilities" id="facilities">
        <div className="section-heading"><div><div className="eyebrow">Everything you need</div><h2>Made for your<br /><em>best hours.</em></h2></div><p>Every detail is considered to help you settle in, stay present, and make progress on the work that matters to you.</p></div>
        <div className="feature-grid"><article><span className="feature-icon"><Library /></span><h3>A seat that fits your rhythm</h3><p>Reserve your preferred spot before you arrive. From window desks to quiet corners, find your kind of focus.</p><a href="#seats">Explore seats <ArrowRight /></a></article><article><span className="feature-icon"><ShieldCheck /></span><h3>Peace, protected</h3><p>Thoughtful rules, clean spaces, and a community that respects the quiet make concentration feel effortless.</p><a href="#contact">Our promise <ArrowRight /></a></article><article><span className="feature-icon"><Users /></span><h3>A community of doers</h3><p>Meet students and professionals who show up with intention. You do not have to study alone.</p><a href="#pricing">Become a member <ArrowRight /></a></article></div>
      </section>

      <section className="booking-section" id="seats"><div className="booking-intro"><div className="eyebrow">Plan your focus</div><h2>Choose your<br /><em>quiet corner.</em></h2><p>See what is available today and reserve a seat in a few clicks. Your next productive session starts here.</p><div className="legend"><span><i className="available" /> Available</span><span><i className="selected" /> Selected</span><span><i className="booked" /> Booked</span></div></div><div className="booking-card"><div className="booking-top"><div><strong>Study floor · Today</strong><small>Tuesday, September 29, 2026</small></div><button aria-label="Select date"><ChevronDown /></button></div><div className="seat-map"><div className="aisle-label">WINDOW DESKS</div>{seats.map((seat) => <button key={seat.label} disabled={seat.state === 'booked' || seat.state === 'maintenance'} className={`seat ${seat.state} ${selectedSeat === seat.label ? 'chosen' : ''}`} onClick={() => setSelectedSeat(seat.label)}>{seat.label}</button>)}<div className="aisle">quiet aisle</div></div><div className="booking-bottom"><div><small>YOUR SELECTION</small><strong>{selectedSeat} <span>·</span> 9:00 AM — 1:00 PM</strong></div><button className="primary-button" onClick={() => showToast(`${selectedSeat} is reserved for you.`)}>Reserve seat <ArrowRight /></button></div></div></section>

      <section className="section pricing" id="pricing"><div className="section-heading"><div><div className="eyebrow">Simple membership</div><h2>Find your<br /><em>flow.</em></h2></div><p>Come for a day or make us part of your routine. All plans include high-speed Wi-Fi, charging access, and a peaceful place to focus.</p></div><div className="plans">{plans.map((plan) => <button key={plan.name} className={`plan ${plan.featured ? 'featured' : ''} ${activePlan === plan.name ? 'active' : ''}`} onClick={() => setActivePlan(plan.name)}>{plan.featured && <span className="popular">Most loved</span>}<span className="plan-name">{plan.name}</span><strong>{plan.price}</strong><span className="plan-detail">{plan.detail}</span><span className="plan-check"><Check /> Includes seat booking</span></button>)}</div></section>

      <section className="cta-section" id="contact"><div><div className="eyebrow">Your next chapter starts here</div><h2>Make room for<br /><em>what matters.</em></h2></div><div><p>Ready to find your place? Come see why focused people choose Peaceful Pages.</p><a className="light-button" href="/auth/sign-up">Register as a student <ArrowRight /></a></div></section>
      <footer><a href="#home" className="brand"><span className="brand-mark"><BookOpen /></span><span><strong>The Peaceful Pages</strong><small>LIBRARY</small></span></a><span className="footer-copy">Read. Relax. Rise.</span><div className="socials"><a href="#contact" aria-label="WhatsApp"><MessageCircle /></a><a href="#contact" aria-label="Instagram"><Camera /></a><a href="#contact" aria-label="Google Maps"><MapPin /></a></div></footer>
      {toast && <div className="toast" role="status"><Check /> {toast}</div>}
    </main>
  )
}
