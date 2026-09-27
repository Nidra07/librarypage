import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import type { User } from '@supabase/supabase-js';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from './src/supabase';

type Screen = 'home' | 'bookings' | 'payments' | 'profile' | 'book' | 'attendance';
type PaymentType = 'registration' | 'monthly';
type PaymentMethod = 'phonepe' | 'cash';
type Profile = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  address: string | null;
  status: 'active' | 'inactive' | 'suspended';
  monthly_fee_override: number | null;
  registration_fee_discount: number;
  registration_fee_waived: boolean;
  default_slot_id: string | null;
};
type Registration = {
  admission_number: string;
  full_name: string;
  email: string;
  phone: string;
  address: string;
  slot_id: string;
  entry_time: string;
  seat_number: string | null;
  created_at: string;
};
type SeatAssignment = { seat_number: number };
type Slot = { id: string; label: string; duration_hours: number; active: boolean };
type Booking = {
  id: string;
  slot_id: string;
  booking_date: string;
  seat_number: number;
  entry_time: string;
  exit_time: string;
  exit_day_offset: number;
  status: 'confirmed' | 'cancelled' | 'completed';
};
type Attendance = { id: string; booking_id: string; attended_on: string; status: 'present' | 'absent' };
type Payment = {
  id: string;
  payment_type: PaymentType;
  billing_month: string | null;
  seat_number: number | null;
  amount: number;
  method: PaymentMethod;
  transaction_reference: string | null;
  status: 'pending' | 'verified' | 'rejected' | 'refunded';
  admin_note: string | null;
  submitted_at: string;
};
type Seat = { seat_number: number; label: string; status: 'available' | 'maintenance' | 'disabled'; is_available: boolean };
type LibrarySettings = { monthly_fee: number | null; phonepe_upi_id: string; phonepe_instructions: string };
type StudentData = {
  profile: Profile | null;
  registration: Registration | null;
  seatAssignment: SeatAssignment | null;
  slots: Slot[];
  bookings: Booking[];
  attendance: Attendance[];
  payments: Payment[];
  settings: LibrarySettings;
};
const WEBSITE_URL = 'https://novus-rudraaksh.vercel.app';

const emptySettings: LibrarySettings = { monthly_fee: null, phonepe_upi_id: '', phonepe_instructions: '' };

function indiaDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year + '-' + values.month + '-' + values.day;
}
function firstOfMonth(date: string) {
  return date.slice(0, 7) + '-01';
}
function shiftMonth(value: string, amount: number) {
  const date = new Date(value + 'T00:00:00Z');
  date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 10);
}
function monthsBetween(start: string, end: string) {
  const months: string[] = [];
  for (let month = start; month <= end; month = shiftMonth(month, 1)) months.push(month);
  return months;
}
function daysUntil(value: string) {
  return Math.max(0, Math.ceil((Date.parse(value + 'T00:00:00Z') - Date.parse(indiaDate() + 'T00:00:00Z')) / 86400000));
}
function indiaMinutes() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
}
function formatDate(value: string) {
  return new Date(value + 'T12:00:00').toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
function formatMonth(value: string) {
  return new Date(value + 'T12:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}
function formatTime(value: string, offset = 0) {
  const time = value.slice(0, 5);
  const [hour, minute] = time.split(':').map(Number);
  const date = new Date(2000, 0, 1, hour, minute);
  return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) + (offset ? ' (next day)' : '');
}
function minutes(value: string) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}
function currency(value: number | null | undefined) {
  if (value == null) return 'Not set';
  return '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value);
}
function monthChoices() {
  const now = new Date();
  now.setDate(1);
  return Array.from({ length: 8 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() + index, 1);
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-01';
  });
}
function timeDate(value: string) {
  const [hour, minute] = value.split(':').map(Number);
  const date = new Date();
  date.setHours(hour || 8, minute || 0, 0, 0);
  return date;
}
function dateValue(date: Date) {
  return indiaDate(date);
}

async function fetchStudentData(studentId: string): Promise<{ data: StudentData | null; error: string | null }> {
  const [profile, registration, seatAssignment, slots, bookings, attendance, payments, settings] = await Promise.all([
    supabase.from('student_profiles').select('id,full_name,email,phone,address,status,monthly_fee_override,registration_fee_discount,registration_fee_waived,default_slot_id').eq('id', studentId).maybeSingle(),
    supabase.from('student_registrations').select('admission_number,full_name,email,phone,address,slot_id,entry_time,seat_number,created_at').eq('student_id', studentId).maybeSingle(),
    supabase.from('student_seat_assignments').select('seat_number').eq('student_id', studentId).maybeSingle(),
    supabase.from('study_slots').select('id,label,duration_hours,active').eq('active', true).order('duration_hours'),
    supabase.from('bookings').select('id,slot_id,booking_date,seat_number,entry_time,exit_time,exit_day_offset,status').eq('student_id', studentId).order('booking_date', { ascending: false }),
    supabase.from('attendance').select('id,booking_id,attended_on,status').eq('student_id', studentId).order('attended_on', { ascending: false }),
    supabase.from('payments').select('id,payment_type,billing_month,seat_number,amount,method,transaction_reference,status,admin_note,submitted_at').eq('student_id', studentId).order('submitted_at', { ascending: false }),
    supabase.from('library_settings').select('monthly_fee,phonepe_upi_id,phonepe_instructions').eq('singleton', true).maybeSingle(),
  ]);
  const error = profile.error ?? registration.error ?? seatAssignment.error ?? slots.error ?? bookings.error ?? attendance.error ?? payments.error ?? settings.error;
  if (error) return { data: null, error: error.message };
  return {
    data: {
      profile: profile.data as Profile | null,
      registration: registration.data as Registration | null,
      seatAssignment: seatAssignment.data as SeatAssignment | null,
      slots: (slots.data ?? []) as Slot[],
      bookings: (bookings.data ?? []) as Booking[],
      attendance: (attendance.data ?? []) as Attendance[],
      payments: (payments.data ?? []) as Payment[],
      settings: (settings.data ?? emptySettings) as LibrarySettings,
    },
    error: null,
  };
}

function Button({
  title,
  onPress,
  disabled = false,
  secondary = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.buttonSecondary,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, secondary && styles.buttonSecondaryText]}>{title}</Text>
    </Pressable>
  );
}
function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}
function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
  multiline,
  editable = true,
  autoCapitalize = 'sentences',
}: {
  label: string;
  value: string;
  onChangeText?: (value: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address' | 'phone-pad';
  multiline?: boolean;
  editable?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words';
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.textArea, !editable && styles.readOnlyInput]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#8c9690"
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        multiline={multiline}
        editable={editable}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
      />
    </View>
  );
}
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value || '—'}</Text>
    </View>
  );
}
function Pill({ label, status }: { label: string; status: string }) {
  const color = status === 'active' || status === 'verified' || status === 'confirmed'
    ? styles.pillSuccess
    : status === 'pending'
      ? styles.pillPending
      : styles.pillMuted;
  return <Text style={[styles.pill, color]}>{label}</Text>;
}
function SelectChip({
  title,
  selected,
  disabled,
  onPress,
}: {
  title: string;
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected), disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected, disabled && styles.chipDisabled]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected, disabled && styles.chipTextDisabled]}>
        {title}
      </Text>
    </Pressable>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<StudentData | null>(null);
  const [screen, setScreen] = useState<Screen>('home');
  const [ready, setReady] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [loadingAuth, setLoadingAuth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [bookingDate, setBookingDate] = useState(indiaDate());
  const [attendanceMonth, setAttendanceMonth] = useState(firstOfMonth(indiaDate()));
  const [slotId, setSlotId] = useState('');
  const [entryTime, setEntryTime] = useState('08:00');
  const [paymentType, setPaymentType] = useState<PaymentType>('monthly');
  const [billingMonth, setBillingMonth] = useState(firstOfMonth(indiaDate()));
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('phonepe');
  const [paymentReference, setPaymentReference] = useState('');
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [loadingSeats, setLoadingSeats] = useState(false);
  const [profileDraft, setProfileDraft] = useState({ full_name: '', phone: '', address: '' });

  const loadAccount = useCallback(async (studentId: string) => {
    setLoadingData(true);
    setErrorMessage('');
    const result = await fetchStudentData(studentId);
    setLoadingData(false);
    if (result.error) {
      setErrorMessage(result.error);
      setData(null);
      return;
    }
    setData(result.data);
  }, []);

  useEffect(() => {
    let mounted = true;
    let loadedStudentId: string | null = null;

    const handleSession = async (nextUser: User | null) => {
      if (!mounted) return;
      if (!nextUser) {
        loadedStudentId = null;
        setUser(null);
        setData(null);
        setLoadingData(false);
        setErrorMessage('');
        setReady(true);
        setScreen('home');
        return;
      }
      if (nextUser.app_metadata?.role === 'admin') {
        loadedStudentId = null;
        setUser(null);
        setData(null);
        setErrorMessage('');
        setNotice('Admin accounts use the website admin panel. This app is for students only.');
        setReady(true);
        setTimeout(() => { void supabase.auth.signOut(); }, 0);
        return;
      }

      setUser(nextUser);
      setReady(true);
      if (loadedStudentId === nextUser.id) return;
      loadedStudentId = nextUser.id;
      await loadAccount(nextUser.id);
    };

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      void handleSession(session?.user ?? null);
    });
    void supabase.auth.getSession().then(({ data: sessionData, error }) => {
      if (!mounted) return;
      if (error) setErrorMessage(error.message);
      void handleSession(sessionData.session?.user ?? null);
    });
    const appStateListener = AppState.addEventListener('change', (state) => {
      if (state === 'active') supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    });
    if (AppState.currentState === 'active') supabase.auth.startAutoRefresh();

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
      appStateListener.remove();
      supabase.auth.stopAutoRefresh();
    };
  }, [loadAccount]);

  useEffect(() => {
    if (data?.profile) {
      setProfileDraft({
        full_name: data.profile.full_name ?? '',
        phone: data.profile.phone ?? '',
        address: data.profile.address ?? '',
      });
      const preferred = data.profile.default_slot_id ?? data.registration?.slot_id ?? data.slots[0]?.id ?? '';
      if (preferred) setSlotId(preferred);
    }
  }, [data]);

  useEffect(() => {
    const fee = data?.profile?.monthly_fee_override ?? data?.settings.monthly_fee ?? null;
    const paidThisMonth = Boolean(data?.payments.some((payment) => payment.payment_type === 'monthly'
      && payment.billing_month === firstOfMonth(indiaDate()) && payment.status === 'verified'
      && fee != null && payment.amount >= fee));
    const chooseForPayment = screen === 'payments' && paymentType === 'monthly'
      && data?.profile?.status === 'active' && !data.seatAssignment;
    const chooseAfterReactivation = screen === 'book' && data?.profile?.status === 'active'
      && !data.seatAssignment && paidThisMonth;
    if ((!chooseForPayment && !chooseAfterReactivation) || !data?.registration) {
      setSeats([]);
      setLoadingSeats(false);
      return;
    }
    let current = true;
    setLoadingSeats(true);
    setSelectedSeat(null);
    const availabilityMonth = chooseAfterReactivation ? firstOfMonth(indiaDate()) : billingMonth;
    void supabase.rpc('get_monthly_seat_availability', { p_billing_month: availabilityMonth }).then(({ data: results, error }) => {
      if (!current) return;
      if (error) {
        setErrorMessage(error.message);
        setSeats([]);
      } else {
        setSeats((results ?? []) as Seat[]);
      }
      setLoadingSeats(false);
    });
    return () => { current = false; };
  }, [billingMonth, data, paymentType, screen]);

  const registrationFeeDue = data?.profile?.registration_fee_waived
    ? 0
    : Math.max(0, 100 - Number(data?.profile?.registration_fee_discount ?? 0));
  const monthlyFee = data?.profile?.monthly_fee_override ?? data?.settings.monthly_fee ?? null;
  const registrationPayment = data?.payments.find((payment) =>
    payment.payment_type === 'registration' && payment.status === 'verified' && payment.amount >= registrationFeeDue,
  );
  const hasRegistrationPayment = registrationFeeDue === 0 || Boolean(registrationPayment);
  const selectedPayment = useMemo(() => {
    if (!data) return undefined;
    const matching = data.payments.filter((payment) =>
      payment.payment_type === paymentType
      && (paymentType === 'registration' || payment.billing_month === billingMonth),
    );
    return matching.find((payment) => payment.status === 'pending')
      ?? matching.find((payment) => payment.status === 'verified'
        && (paymentType === 'registration'
          ? payment.amount >= registrationFeeDue
          : monthlyFee != null && payment.amount >= monthlyFee))
      ?? matching[0];
  }, [billingMonth, data, monthlyFee, paymentType, registrationFeeDue]);
  const paymentAmount = paymentType === 'registration' ? registrationFeeDue : monthlyFee;
  const paymentAlreadyCurrent = Boolean(selectedPayment && (
    selectedPayment.status === 'pending'
    || (selectedPayment.status === 'verified' && paymentAmount != null && selectedPayment.amount >= paymentAmount)
  ));
  const bookingMonthPayment = data?.payments.find((payment) =>
    payment.payment_type === 'monthly'
    && payment.billing_month === firstOfMonth(bookingDate)
    && payment.status === 'verified'
    && monthlyFee != null
    && payment.amount >= monthlyFee,
  );
  const currentMonth = firstOfMonth(indiaDate());
  const currentMonthPaid = Boolean(data?.payments.some((payment) => payment.payment_type === 'monthly'
    && payment.billing_month === currentMonth && payment.status === 'verified'
    && monthlyFee != null && payment.amount >= monthlyFee));
  const bookingMonthPaid = Boolean(bookingMonthPayment);
  const allocatedSeat = data?.seatAssignment?.seat_number ?? null;
  const canBook = Boolean(
    data?.profile?.status === 'active'
    && data.registration
    && hasRegistrationPayment
    && monthlyFee != null
    && bookingMonthPaid
    && allocatedSeat != null,
  );
  const selectedSlot = data?.slots.find((slot) => slot.id === slotId);
  const exitMinutes = selectedSlot ? minutes(entryTime) + selectedSlot.duration_hours * 60 : 0;
  const validBookingTime = Boolean(selectedSlot && minutes(entryTime) >= 360 && exitMinutes <= 1320);
  const attendanceByBookingId = new Map((data?.attendance ?? []).map((record) => [record.booking_id, record]));
  const monthBookings = (data?.bookings ?? []).filter((booking) => booking.booking_date.slice(0, 7) === attendanceMonth && booking.status !== 'cancelled');
  const monthAttendance = (data?.attendance ?? []).filter((record) => record.attended_on.slice(0, 7) === attendanceMonth);
  const monthPresentDays = new Set(monthAttendance.filter((record) => record.status === 'present').map((record) => record.attended_on)).size;
  const presentDates = new Set(monthAttendance.filter((record) => record.status === 'present').map((record) => record.attended_on));
  const monthAbsentDays = new Set(monthAttendance.filter((record) => record.status === 'absent' && !presentDates.has(record.attended_on)).map((record) => record.attended_on)).size;
  const monthUnmarkedVisits = monthBookings.filter((booking) => !attendanceByBookingId.has(booking.id)).length;
  const currentPresentDays = new Set((data?.attendance ?? []).filter((record) => record.status === 'present' && record.attended_on.slice(0, 7) === currentMonth.slice(0, 7)).map((record) => record.attended_on)).size;
  const registrationMonth = data?.registration?.created_at ? firstOfMonth(data.registration.created_at.slice(0, 10)) : currentMonth;
  const verifiedMonthlyPayments = (data?.payments ?? []).filter((payment) => payment.payment_type === 'monthly'
    && payment.status === 'verified' && monthlyFee != null && payment.amount >= monthlyFee && payment.billing_month);
  const paidMonths = new Set(verifiedMonthlyPayments.map((payment) => payment.billing_month as string));
  const pendingFeeMonths = data?.registration && monthlyFee != null && registrationMonth <= currentMonth
    ? monthsBetween(registrationMonth, currentMonth).filter((month) => !paidMonths.has(month))
    : [];
  const latestPaidMonth = verifiedMonthlyPayments.reduce((latest, payment) =>
    payment.billing_month && payment.billing_month > latest ? payment.billing_month : latest, currentMonth);
  const nextFeeMonth = pendingFeeMonths[0] ?? monthsBetween(shiftMonth(currentMonth, 1), latestPaidMonth > currentMonth ? latestPaidMonth : shiftMonth(currentMonth, 1)).find((month) => !paidMonths.has(month));
  const daysToNextFee = nextFeeMonth ? (pendingFeeMonths.length ? 0 : daysUntil(nextFeeMonth)) : null;
  const nextFeeIsOverdue = Boolean(pendingFeeMonths.length && (pendingFeeMonths[0] < currentMonth || indiaDate() > pendingFeeMonths[0]));

  async function refresh() {
    if (user) await loadAccount(user.id);
  }

  async function signIn() {
    setLoadingAuth(true);
    setErrorMessage('');
    setNotice('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoadingAuth(false);
    if (error) setErrorMessage(error.code === 'email_not_confirmed'
      ? 'Confirm your email on the website before signing in.'
      : error.code === 'invalid_credentials'
        ? 'Email or password is incorrect.'
        : error.message);
  }

  async function signOut() {
    await supabase.auth.signOut();
    setPassword('');
    setNotice('You have signed out.');
  }

  function chooseBookingDate() {
    DateTimePickerAndroid.open({
      value: new Date(bookingDate + 'T12:00:00'),
      mode: 'date',
      display: 'calendar',
      minimumDate: new Date(),
      onChange: (_event, value) => {
        if (value) setBookingDate(dateValue(value));
      },
    });
  }
  function chooseEntryTime() {
    DateTimePickerAndroid.open({
      value: timeDate(entryTime),
      mode: 'time',
      display: 'clock',
      is24Hour: true,
      onChange: (_event, value) => {
        if (value) setEntryTime(String(value.getHours()).padStart(2, '0') + ':' + String(value.getMinutes()).padStart(2, '0'));
      },
    });
  }
  function chooseBillingMonth(value: string) {
    setBillingMonth(value);
    setSelectedSeat(null);
  }

  async function assignSeat(seatNumber: number) {
    setBusy(true);
    setErrorMessage('');
    setNotice('');
    const { error } = await supabase.rpc('claim_student_seat', { p_seat_number: seatNumber });
    setBusy(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    setSelectedSeat(null);
    setNotice('Seat ' + seatNumber + ' is now assigned to you while your account is active.');
    await refresh();
  }

  async function markAttendance(bookingId: string) {
    setBusy(true);
    setErrorMessage('');
    setNotice('');
    const { error } = await supabase.rpc('mark_my_attendance', { p_booking_id: bookingId });
    setBusy(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    setNotice('You have been marked present for today.');
    await refresh();
  }

  async function createBooking() {
    if (!data || !selectedSlot || !validBookingTime) {
      setErrorMessage('Choose a visit duration and a start time that finishes by 10:00 PM.');
      return;
    }
    if (!canBook || allocatedSeat == null) {
      setErrorMessage('Your registration and monthly payment must be verified before you can book.');
      return;
    }
    setBusy(true);
    setErrorMessage('');
    setNotice('');
    const { error } = await supabase.rpc('book_seat', {
      p_booking_date: bookingDate,
      p_slot_id: slotId,
      p_seat_number: allocatedSeat,
      p_entry_time: entryTime + ':00',
    });
    setBusy(false);
    if (error) {
      setErrorMessage(/already booked|overlap|exclusion|seat.*booked/i.test(error.message)
        ? 'That seat is already reserved for this time. Choose a different date, duration, or entry time.'
        : error.message);
      return;
    }
    setNotice('Your booking is confirmed.');
    setScreen('bookings');
    await refresh();
  }

  async function cancelBooking(bookingId: string) {
    setBusy(true);
    setErrorMessage('');
    setNotice('');
    const { error } = await supabase.rpc('cancel_my_booking', { p_booking_id: bookingId });
    setBusy(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    setNotice('Visit cancelled; your assigned seat remains yours while your account is active.');
    await refresh();
  }

  async function submitPayment() {
    if (paymentAmount == null || paymentAmount <= 0) {
      setErrorMessage('There is no payment due for this item.');
      return;
    }
    const monthlyPaymentSeat = allocatedSeat ?? selectedSeat;
    if (paymentType === 'monthly' && data?.profile?.status !== 'active') {
      setErrorMessage('Ask the administrator to reactivate your account before making a monthly payment.');
      return;
    }
    if (paymentType === 'monthly' && monthlyPaymentSeat == null) {
      setErrorMessage('Choose a vacant seat before submitting payment.');
      return;
    }
    if (paymentMethod === 'phonepe' && !paymentReference.trim()) {
      setErrorMessage('Enter the UPI transaction reference.');
      return;
    }

    setBusy(true);
    setErrorMessage('');
    setNotice('');
    const { error } = await supabase.rpc('submit_payment', {
      p_payment_type: paymentType,
      p_billing_month: paymentType === 'monthly' ? billingMonth : null,
      p_method: paymentMethod,
      p_transaction_reference: paymentMethod === 'phonepe' ? paymentReference.trim() : null,
      p_seat_number: paymentType === 'monthly' ? monthlyPaymentSeat : null,
    });
    setBusy(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    setPaymentReference('');
    setSelectedSeat(null);
    setNotice('Payment submitted for admin verification. Your monthly seat is held while it is reviewed.');
    await refresh();
  }

  async function saveProfile() {
    if (!profileDraft.full_name.trim() || !profileDraft.phone.trim()) {
      setErrorMessage('Name and phone number are required.');
      return;
    }
    setBusy(true);
    setErrorMessage('');
    setNotice('');
    const { error } = await supabase.rpc('update_my_student_profile', {
      p_full_name: profileDraft.full_name.trim(),
      p_phone: profileDraft.phone.trim(),
      p_address: profileDraft.address.trim(),
    });
    setBusy(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    setNotice('Profile saved.');
    await refresh();
  }

  async function openUpiPayment() {
    if (!data?.settings.phonepe_upi_id || paymentAmount == null) return;
    const note = paymentType === 'registration' ? 'Library registration fee' : 'Library fee ' + billingMonth.slice(0, 7);
    const link = 'upi://pay?pa=' + encodeURIComponent(data.settings.phonepe_upi_id)
      + '&pn=' + encodeURIComponent('The Peaceful Pages')
      + '&am=' + encodeURIComponent(String(paymentAmount))
      + '&cu=INR&tn=' + encodeURIComponent(note);
   try {
     await Linking.openURL(link);
   } catch {
      Alert.alert('Unable to open UPI', 'Install a UPI app, try again, or pay at the library desk.');
    }
  }

  async function openWebsite(path: string) {
    try {
      await Linking.openURL(WEBSITE_URL + path);
    } catch {
      Alert.alert('Unable to open the website', 'Open The Peaceful Pages website in your browser and try again.');
    }
  }

  const renderLogin = () => (
    <ScrollView contentContainerStyle={styles.authScroll} keyboardShouldPersistTaps="handled">
      <View style={styles.authCard}>
        <View style={styles.brandMark}><Text style={styles.brandMarkText}>P</Text></View>
        <Text style={styles.brandTitle}>The Peaceful Pages</Text>
        <Text style={styles.brandSubTitle}>STUDENT PORTAL</Text>
        <Text style={styles.welcomeTitle}>Welcome back.</Text>
        <Text style={styles.muted}>Sign in with the student account you created on the website.</Text>
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
        <Field label="Email address" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" />
        <Field label="Password" value={password} onChangeText={setPassword} placeholder="Your password" secureTextEntry autoCapitalize="none" />
        <Button title={loadingAuth ? 'Signing in…' : 'Sign in'} onPress={() => void signIn()} disabled={loadingAuth || !email.trim() || !password} />
        <Button title="Create an account on the website" onPress={() => void openWebsite('/auth/sign-up')} secondary />
        <Text style={styles.authFoot}>Student registration and account creation are available on the website only.</Text>
      </View>
    </ScrollView>
  );

  const renderRegistrationMessage = () => (
    <Card>
      <Text style={styles.sectionTitle}>Complete website registration</Text>
      <Text style={styles.muted}>
        Your student account is signed in, but its offline admission registration is not complete yet.
        Complete the one-time registration on The Peaceful Pages website, then return here and sign in again.
      </Text>
      <Button title="Complete registration on the website" onPress={() => void openWebsite('/student/register')} />
      <Button title="Sign out" onPress={() => void signOut()} secondary />
    </Card>
  );

  const renderHome = () => {
    const regDueText = registrationFeeDue === 0
      ? 'Waived'
      : hasRegistrationPayment
        ? 'Verified'
        : currency(registrationFeeDue) + ' due';
    const feeDueText = daysToNextFee == null
      ? 'No due date yet'
      : pendingFeeMonths.length
        ? (nextFeeIsOverdue ? 'Overdue' : 'Due today')
        : daysToNextFee === 0 ? 'Due today' : daysToNextFee + (daysToNextFee === 1 ? ' day' : ' days') + ' left';
    return (
      <>
        <View style={styles.hero}>
          <Text style={styles.heroEyebrow}>STUDENT PORTAL</Text>
          <Text style={styles.heroTitle}>Hello, {data?.profile?.full_name || 'student'}</Text>
          <Text style={styles.heroText}>Admission {data?.registration?.admission_number || '—'}</Text>
        </View>
        {data?.profile?.status !== 'active' && (
          <Card><Text style={styles.warning}>Your account is {data?.profile?.status ?? 'unavailable'}. Contact the library administrator for help.</Text></Card>
        )}
        <View style={styles.metricGrid}>
          <Card><Text style={styles.metricLabel}>Membership</Text><Pill label={data?.profile?.status ?? 'unknown'} status={data?.profile?.status ?? ''} /></Card>
          <Card><Text style={styles.metricLabel}>Registration fee</Text><Text style={styles.metricValue}>{regDueText}</Text></Card>
          <Card><Text style={styles.metricLabel}>Attendance this month</Text><Text style={styles.metricValue}>{currentPresentDays} days</Text><Text style={styles.muted}>Days attended</Text></Card>
        </View>
        <Card>
          <Text style={styles.sectionTitle}>Monthly fees</Text>
          <Text style={styles.metricValue}>{currency(monthlyFee)}</Text>
          <Text style={styles.muted}>Next fee: {feeDueText}{nextFeeMonth ? ' · ' + formatMonth(nextFeeMonth) : ''}</Text>
          <Text style={styles.muted}>{allocatedSeat == null ? 'No seat assigned. Choose a vacant seat after your current monthly fee is verified.' : 'Seat ' + allocatedSeat + ' stays assigned while your account is active.'}</Text>
          <Text style={styles.sectionSubtitle}>Pending months</Text>
          {pendingFeeMonths.length ? pendingFeeMonths.map((month) => (
            <View key={month} style={styles.recordTop}>
              <Text style={styles.muted}>{formatMonth(month)}</Text>
              <Text style={styles.pillPending}>{data?.payments.some((payment) => payment.payment_type === 'monthly' && payment.billing_month === month && payment.status === 'pending') ? 'Awaiting confirmation' : 'Pending'}</Text>
            </View>
          )) : <Text style={styles.muted}>{monthlyFee == null ? 'Monthly fee has not been set by the administrator.' : 'No monthly fees are pending.'}</Text>}
          <Button title="Payments" onPress={() => setScreen('payments')} secondary />
          <View style={styles.buttonRow}>
            <Button title="Book a visit" onPress={() => { setScreen('book'); setNotice(''); setErrorMessage(''); }} />
            <Button title="My bookings" onPress={() => setScreen('bookings')} secondary />
          </View>
        </Card>
      </>
    );
  };

  const renderAttendance = () => {
    const availableMonths = Array.from({ length: 6 }, (_, index) => shiftMonth(currentMonth, -index));
    const canCheckIn = indiaMinutes() >= 360 && indiaMinutes() < 1320;
    return (
      <Card>
        <Text style={styles.sectionTitle}>Monthly attendance</Text>
        <Text style={styles.muted}>Attendance is counted by days attended. Mark present for today’s confirmed visit before 10:00 PM India time.</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {availableMonths.map((month) => (
            <SelectChip key={month} title={formatMonth(month)} selected={attendanceMonth === month} onPress={() => setAttendanceMonth(month)} />
          ))}
        </ScrollView>
        <View style={styles.metricGrid}>
          <Card><Text style={styles.metricLabel}>Present days</Text><Text style={styles.metricValue}>{monthPresentDays}</Text></Card>
          <Card><Text style={styles.metricLabel}>Absent days</Text><Text style={styles.metricValue}>{monthAbsentDays}</Text></Card>
          <Card><Text style={styles.metricLabel}>Visits</Text><Text style={styles.metricValue}>{monthBookings.length}</Text></Card>
        </View>
        {monthBookings.map((booking) => {
          const record = attendanceByBookingId.get(booking.id);
          const canMark = booking.booking_date === indiaDate() && booking.status === 'confirmed'
            && !record && data?.profile?.status === 'active' && canCheckIn;
          return (
            <View style={styles.record} key={booking.id}>
              <View style={styles.recordTop}>
                <Text style={styles.recordTitle}>{formatDate(booking.booking_date)}</Text>
                <Pill label={record?.status ?? (booking.booking_date > indiaDate() ? 'upcoming' : 'awaiting')} status={record?.status ?? booking.status} />
              </View>
              <Text style={styles.muted}>Seat {booking.seat_number} · {data?.slots.find((slot) => slot.id === booking.slot_id)?.label ?? 'Library visit'}</Text>
              {canMark ? <Button title={busy ? 'Saving…' : 'Mark present'} onPress={() => void markAttendance(booking.id)} disabled={busy} /> : null}
            </View>
          );
        })}
        {monthBookings.length === 0 ? <Text style={styles.empty}>No visits booked for this month.</Text> : null}
        <Text style={styles.muted}>Unmarked confirmed visits are set absent after closing time.</Text>
      </Card>
    );
  };

  const renderBookings = () => (
    <Card>
      <Text style={styles.sectionTitle}>Your bookings</Text>
      <Text style={styles.muted}>Your seat stays assigned while your account is active. Admin status changes release the seat and cancel future visits.</Text>
      <Button title="Book a visit" onPress={() => { setScreen('book'); setNotice(''); setErrorMessage(''); }} />
      {(data?.bookings ?? []).length === 0 ? <Text style={styles.empty}>No bookings yet.</Text> : null}
      {(data?.bookings ?? []).map((booking) => (
        <View key={booking.id} style={styles.record}>
          <View style={styles.recordTop}>
            <Text style={styles.recordTitle}>{formatDate(booking.booking_date)}</Text>
            <Pill label={booking.status} status={booking.status} />
          </View>
          <Text style={styles.muted}>Seat {booking.seat_number} · {data?.slots.find((slot) => slot.id === booking.slot_id)?.label ?? 'Study visit'}</Text>
          <Text style={styles.muted}>{formatTime(booking.entry_time)} – {formatTime(booking.exit_time, booking.exit_day_offset)}</Text>
          {booking.status === 'confirmed' && booking.booking_date >= indiaDate() ? (
            <Pressable accessibilityRole="button" style={styles.cancelButton} onPress={() => void cancelBooking(booking.id)} disabled={busy}>
              <Text style={styles.cancelText}>{busy ? 'Please wait…' : 'Cancel booking'}</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </Card>
  );

  const renderBookingForm = () => (
    <Card>
      <Pressable onPress={() => setScreen('bookings')} accessibilityRole="button"><Text style={styles.backLink}>‹ My bookings</Text></Pressable>
      <Text style={styles.sectionTitle}>Book a visit</Text>
      <Text style={styles.muted}>The library is open daily from 6:00 AM to 10:00 PM.</Text>
      {!canBook && !(data?.profile?.status === 'active' && currentMonthPaid && allocatedSeat == null) ? (
        <View style={styles.noticeBox}>
          <Text style={styles.noticeBoxTitle}>Booking is not available yet</Text>
          <Text style={styles.muted}>
            {data?.profile?.status !== 'active'
              ? 'Your membership is inactive. Contact the administrator to be reactivated.'
              : !hasRegistrationPayment
                ? 'Your registration fee must be confirmed first.'
                : !monthlyFee
                  ? 'The library has not set your monthly fee yet.'
                  : !bookingMonthPaid
                    ? 'The monthly fee for ' + formatMonth(firstOfMonth(bookingDate)) + ' must be confirmed.'
                    : 'Choose a vacant seat before booking.'}
          </Text>
          {data?.profile?.status === 'active' && !bookingMonthPaid ? <Button title="Go to payments" onPress={() => setScreen('payments')} secondary /> : null}
        </View>
      ) : null}
      {data?.profile?.status === 'active' && currentMonthPaid && allocatedSeat == null ? (
        <View style={styles.noticeBox}>
          <Text style={styles.noticeBoxTitle}>Choose a vacant seat to resume</Text>
          <Text style={styles.muted}>Your fee for this month is verified. Choose an available seat; it will stay assigned while your account is active.</Text>
          {loadingSeats ? <ActivityIndicator color="#235b48" /> : (
            <View style={styles.seatGrid}>
              {seats.map((seat) => {
                const free = seat.status === 'available' && seat.is_available;
                return (
                  <Pressable key={seat.seat_number} accessibilityRole="button"
                    accessibilityLabel={'Seat ' + seat.seat_number + (free ? ', available' : ', unavailable')}
                    accessibilityState={{ selected: selectedSeat === seat.seat_number, disabled: !free }}
                    disabled={!free || busy} onPress={() => setSelectedSeat(seat.seat_number)}
                    style={[styles.seat, selectedSeat === seat.seat_number && styles.seatSelected, !free && styles.seatDisabled]}>
                    <Text style={[styles.seatText, selectedSeat === seat.seat_number && styles.seatTextSelected, !free && styles.seatTextDisabled]}>{seat.seat_number}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
          <Button title={busy ? 'Saving…' : 'Assign selected seat'} onPress={() => selectedSeat != null && void assignSeat(selectedSeat)} disabled={busy || loadingSeats || selectedSeat == null} />
        </View>
      ) : null}
      <Text style={styles.label}>Visit date</Text>
      <Pressable accessibilityRole="button" style={styles.pickerButton} onPress={chooseBookingDate}>
        <Text style={styles.pickerValue}>{formatDate(bookingDate)}</Text>
        <Text style={styles.pickerHint}>Choose date</Text>
      </Pressable>
      <Text style={styles.label}>Visit duration</Text>
      <View style={styles.chipRow}>
        {(data?.slots ?? []).map((slot) => (
          <SelectChip
            key={slot.id}
            title={slot.label + ' · ' + slot.duration_hours + 'h'}
            selected={slotId === slot.id}
            onPress={() => setSlotId(slot.id)}
          />
        ))}
      </View>
      <Text style={styles.label}>Entry time</Text>
      <Pressable accessibilityRole="button" style={styles.pickerButton} onPress={chooseEntryTime}>
        <Text style={styles.pickerValue}>{formatTime(entryTime)}</Text>
        <Text style={styles.pickerHint}>Choose time</Text>
      </Pressable>
      {selectedSlot ? (
        <View style={styles.noticeBox}>
          <Text style={styles.noticeBoxTitle}>{allocatedSeat == null ? 'No seat assigned' : 'Seat ' + allocatedSeat + ' remains assigned while active'}</Text>
          <Text style={styles.muted}>
            Entry {formatTime(entryTime)} · Exit {exitMinutes > 1320 ? 'after closing' : formatTime(String(Math.floor(exitMinutes / 60)).padStart(2, '0') + ':' + String(exitMinutes % 60).padStart(2, '0'))}
          </Text>
        </View>
      ) : null}
      {selectedSlot && !validBookingTime ? <Text style={styles.error}>Choose an entry time that allows your full visit to finish by 10:00 PM.</Text> : null}
      <Button title={busy ? 'Booking…' : 'Confirm booking'} onPress={() => void createBooking()} disabled={busy || !canBook || !validBookingTime || !selectedSlot} />
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
    </Card>
  );

  const renderPayments = () => {
    const canResubmit = !selectedPayment || selectedPayment.status === 'rejected' || selectedPayment.status === 'refunded';
    return (
      <>
        <Card>
          <Text style={styles.sectionTitle}>Payments</Text>
          <Text style={styles.muted}>Payments are confirmed by the library administrator. Your assigned seat stays yours while your account is active.</Text>
          <View style={styles.chipRow}>
            <SelectChip title="Monthly fee" selected={paymentType === 'monthly'} onPress={() => { setPaymentType('monthly'); setSelectedSeat(null); setErrorMessage(''); }} />
            <SelectChip title="Registration fee" selected={paymentType === 'registration'} onPress={() => { setPaymentType('registration'); setErrorMessage(''); }} />
          </View>
          {paymentType === 'monthly' ? (
            <>
              <Text style={styles.label}>Billing month</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {monthChoices().map((month) => (
                  <SelectChip key={month} title={formatMonth(month)} selected={billingMonth === month} onPress={() => chooseBillingMonth(month)} />
                ))}
              </ScrollView>
              {allocatedSeat != null ? (
                <Text style={styles.muted}>Seat {allocatedSeat} stays assigned to you while your account is active. Monthly payments do not change your seat.</Text>
              ) : data?.profile?.status !== 'active' ? (
                <Text style={styles.muted}>Ask the administrator to reactivate your account before choosing a vacant seat or paying monthly fees.</Text>
              ) : currentMonthPaid ? (
                <View style={styles.noticeBox}>
                  <Text style={styles.muted}>This month’s fee is verified. Choose a vacant seat in Book a visit to resume.</Text>
                  <Button title="Choose a vacant seat" onPress={() => setScreen('book')} secondary />
                </View>
              ) : (
                <>
                  <Text style={styles.sectionSubtitle}>Choose a vacant seat</Text>
                  {loadingSeats ? <ActivityIndicator color="#235b48" /> : (
                    <View style={styles.seatGrid}>
                      {seats.map((seat) => {
                        const free = seat.status === 'available' && seat.is_available;
                        return (
                          <Pressable key={seat.seat_number} accessibilityRole="button"
                            accessibilityLabel={'Seat ' + seat.seat_number + (free ? ', available' : ', unavailable')}
                            accessibilityState={{ selected: selectedSeat === seat.seat_number, disabled: !free }}
                            disabled={!free || busy} onPress={() => setSelectedSeat(seat.seat_number)}
                            style={[styles.seat, selectedSeat === seat.seat_number && styles.seatSelected, !free && styles.seatDisabled]}>
                            <Text style={[styles.seatText, selectedSeat === seat.seat_number && styles.seatTextSelected, !free && styles.seatTextDisabled]}>{seat.seat_number}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                  <Text style={styles.muted}>After this monthly payment is confirmed, the selected seat stays assigned while your account is active.</Text>
                  {selectedSeat != null ? <Text style={styles.selectedSeatText}>Selected seat: {selectedSeat}</Text> : null}
                </>
              )}
            </>
          ) : (
            <Text style={styles.muted}>
              Registration fee: {registrationFeeDue === 0 ? 'waived by the administrator' : currency(registrationFeeDue)}.
            </Text>
          )}
          <View style={styles.amountRow}>
            <Text style={styles.label}>Amount due</Text>
            <Text style={styles.amount}>{currency(paymentAmount)}</Text>
          </View>
          {selectedPayment ? (
            <View style={styles.noticeBox}>
              <View style={styles.recordTop}>
                <Text style={styles.noticeBoxTitle}>Current payment</Text>
                <Pill label={selectedPayment.status} status={selectedPayment.status} />
              </View>
              <Text style={styles.muted}>
                {selectedPayment.payment_type === 'monthly'
                  ? (selectedPayment.seat_number == null ? 'No seat was selected.' : 'Seat ' + selectedPayment.seat_number + ' · ' + formatMonth(selectedPayment.billing_month ?? billingMonth))
                  : 'One-time registration payment'}
              </Text>
              {selectedPayment.admin_note ? <Text style={styles.muted}>Admin note: {selectedPayment.admin_note}</Text> : null}
            </View>
          ) : null}
          {paymentMethod === 'phonepe' && data?.settings.phonepe_upi_id ? (
            <View style={styles.noticeBox}>
              <Text style={styles.noticeBoxTitle}>PhonePe / UPI</Text>
              <Text style={styles.muted}>{data.settings.phonepe_instructions || 'Pay using the library UPI ID, then enter the transaction reference.'}</Text>
              <Text style={styles.selectedSeatText}>UPI ID: {data.settings.phonepe_upi_id}</Text>
              <Button title="Open UPI app" onPress={() => void openUpiPayment()} secondary disabled={paymentAmount == null} />
            </View>
          ) : null}
          {paymentMethod === 'phonepe' ? (
            <Field label="UPI transaction reference" value={paymentReference} onChangeText={setPaymentReference} placeholder="Reference shown after payment" autoCapitalize="none" />
          ) : (
            <Text style={styles.muted}>Choose cash if you have paid at the library desk. The administrator will confirm receipt.</Text>
          )}
          <View style={styles.chipRow}>
            <SelectChip title="UPI / PhonePe" selected={paymentMethod === 'phonepe'} onPress={() => setPaymentMethod('phonepe')} />
            <SelectChip title="Cash at library" selected={paymentMethod === 'cash'} onPress={() => setPaymentMethod('cash')} />
          </View>
          {canResubmit ? (
            <Button
              title={busy ? 'Submitting…' : 'Submit for verification'}
              onPress={() => void submitPayment()}
              disabled={busy || paymentAmount == null || paymentAmount <= 0 || paymentAlreadyCurrent
                || (paymentType === 'monthly' && (data?.profile?.status !== 'active'
                  || (allocatedSeat == null && (loadingSeats || selectedSeat == null))))}
            />
          ) : null}
          {selectedPayment?.status === 'pending' ? <Text style={styles.muted}>Wait for the administrator to review this payment before submitting another.</Text> : null}
          {selectedPayment?.status === 'verified' ? <Text style={styles.success}>Payment verified{paymentType === 'monthly' && allocatedSeat != null ? ' · seat ' + allocatedSeat + ' remains assigned while active' : ''}.</Text> : null}
        </Card>
        <Card>
          <Text style={styles.sectionTitle}>Payment history</Text>
          {(data?.payments ?? []).length === 0 ? <Text style={styles.empty}>No payments submitted yet.</Text> : null}
          {(data?.payments ?? []).map((payment) => (
            <View style={styles.record} key={payment.id}>
              <View style={styles.recordTop}>
                <Text style={styles.recordTitle}>{payment.payment_type === 'monthly' ? 'Monthly · ' + formatMonth(payment.billing_month ?? '') : 'Registration fee'}</Text>
                <Pill label={payment.status} status={payment.status} />
              </View>
              <Text style={styles.muted}>{currency(payment.amount)} · {payment.method === 'phonepe' ? 'UPI / PhonePe' : 'Cash'}</Text>
              {payment.seat_number != null ? <Text style={styles.muted}>Seat {payment.seat_number}</Text> : null}
              {payment.transaction_reference ? <Text style={styles.muted}>Reference: {payment.transaction_reference}</Text> : null}
              {payment.admin_note ? <Text style={styles.muted}>Admin note: {payment.admin_note}</Text> : null}
              <Text style={styles.muted}>Submitted {formatDate(payment.submitted_at.slice(0, 10))}</Text>
            </View>
          ))}
        </Card>
      </>
    );
  };

  const renderProfile = () => (
    <>
      <Card>
        <Text style={styles.sectionTitle}>Student details</Text>
        <InfoRow label="Admission number" value={data?.registration?.admission_number ?? ''} />
        <InfoRow label="Email" value={user?.email ?? data?.profile?.email ?? ''} />
        <InfoRow label="Membership" value={data?.profile?.status ?? ''} />
        <InfoRow label="Seat while active" value={allocatedSeat == null ? 'Choose a vacant seat after payment' : 'Seat ' + allocatedSeat} />
      </Card>
      <Card>
        <Text style={styles.sectionTitle}>Edit profile</Text>
        <Text style={styles.muted}>Your admission number and login email are read-only.</Text>
        <Field label="Full name" value={profileDraft.full_name} onChangeText={(value) => setProfileDraft((current) => ({ ...current, full_name: value }))} />
        <Field label="Admission number" value={data?.registration?.admission_number ?? ''} editable={false} />
        <Field label="Email address" value={user?.email ?? ''} editable={false} />
        <Field label="Phone number" value={profileDraft.phone} onChangeText={(value) => setProfileDraft((current) => ({ ...current, phone: value }))} keyboardType="phone-pad" />
        <Field label="Address" value={profileDraft.address} onChangeText={(value) => setProfileDraft((current) => ({ ...current, address: value }))} multiline />
        <Button title={busy ? 'Saving…' : 'Save profile'} onPress={() => void saveProfile()} disabled={busy} />
      </Card>
      <Button title="Sign out" onPress={() => void signOut()} secondary />
    </>
  );

  if (!ready) return <LoadingScreen label="Checking your student account…" />;
  if (!user) return <AppShell>{renderLogin()}</AppShell>;
  if (loadingData) return <LoadingScreen label="Loading your library account…" />;
  if (!data && errorMessage) {
    return (
      <AppShell>
        <View style={styles.header}>
          <Text style={styles.headerBrand}>The Peaceful Pages</Text>
          <Text style={styles.headerLabel}>Student portal</Text>
        </View>
        <Card>
          <Text style={styles.sectionTitle}>Could not load your account</Text>
          <Text style={styles.error}>{errorMessage}</Text>
          <Button title="Try again" onPress={() => { if (user) void loadAccount(user.id); }} />
          <Button title="Sign out" onPress={() => void signOut()} secondary />
        </Card>
      </AppShell>
    );
  }
  if (!data?.registration) {
    return (
      <AppShell>
        <View style={styles.header}>
          <Text style={styles.headerBrand}>The Peaceful Pages</Text>
          <Text style={styles.headerLabel}>Student portal</Text>
        </View>
        {errorMessage ? <Text style={styles.errorBanner}>{errorMessage}</Text> : null}
        {renderRegistrationMessage()}
      </AppShell>
    );
  }

  const title = screen === 'home' ? 'Dashboard'
    : screen === 'bookings' ? 'My bookings'
      : screen === 'payments' ? 'Payments'
        : screen === 'profile' ? 'Profile'
          : screen === 'attendance' ? 'Attendance'
            : 'Book a visit';

  return (
    <AppShell>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerBrand}>The Peaceful Pages</Text>
          <Text style={styles.headerLabel}>{title}</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={() => void signOut()}><Text style={styles.headerAction}>Sign out</Text></Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {notice ? <Text style={styles.noticeBanner}>{notice}</Text> : null}
        {errorMessage ? <Text style={styles.errorBanner}>{errorMessage}</Text> : null}
        {screen === 'home' ? renderHome()
          : screen === 'bookings' ? renderBookings()
            : screen === 'payments' ? renderPayments()
              : screen === 'profile' ? renderProfile()
                : screen === 'attendance' ? renderAttendance()
                  : renderBookingForm()}
      </ScrollView>
      {screen !== 'book' ? (
        <View style={styles.tabBar}>
          <Tab title="Home" selected={screen === 'home'} onPress={() => setScreen('home')} />
          <Tab title="Bookings" selected={screen === 'bookings'} onPress={() => setScreen('bookings')} />
          <Tab title="Attendance" selected={screen === 'attendance'} onPress={() => setScreen('attendance')} />
          <Tab title="Payments" selected={screen === 'payments'} onPress={() => setScreen('payments')} />
          <Tab title="Profile" selected={screen === 'profile'} onPress={() => setScreen('profile')} />
        </View>
      ) : null}
    </AppShell>
  );
}

function Tab({ title, selected, onPress }: { title: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected }} onPress={onPress} style={styles.tab}>
      <Text style={[styles.tabText, selected && styles.tabTextSelected]}>{title}</Text>
    </Pressable>
  );
}

function LoadingScreen({ label }: { label: string }) {
  return (
    <AppShell>
      <View style={styles.loading}>
        <ActivityIndicator color="#245c48" size="large" />
        <Text style={styles.muted}>{label}</Text>
      </View>
    </AppShell>
  );
}
function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <StatusBar barStyle="light-content" backgroundColor="#183c32" />
          {children}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f5f6f2' },
  keyboard: { flex: 1 },
  header: { backgroundColor: '#183c32', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerBrand: { color: '#f7f7f0', fontSize: 18, fontWeight: '800' },
  headerLabel: { color: '#c8d7ce', fontSize: 13, marginTop: 4 },
  headerAction: { color: '#e0eee5', fontWeight: '700', padding: 8 },
  content: { padding: 16, paddingBottom: 26, gap: 14 },
  card: { backgroundColor: '#ffffff', borderRadius: 18, borderWidth: 1, borderColor: '#e4e9e3', padding: 17, marginBottom: 14, shadowColor: '#20372c', shadowOpacity: 0.04, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  hero: { backgroundColor: '#e3eee5', borderRadius: 20, padding: 20, marginBottom: 14 },
  heroEyebrow: { color: '#38634f', letterSpacing: 1.3, fontSize: 11, fontWeight: '800' },
  heroTitle: { color: '#183c32', fontSize: 26, fontWeight: '800', marginTop: 7 },
  heroText: { color: '#58685d', marginTop: 7 },
  metricGrid: { flexDirection: 'column', gap: 0, marginBottom: 0 },
  metricLabel: { color: '#718078', fontSize: 12, fontWeight: '700', marginBottom: 8 },
  metricValue: { color: '#183c32', fontSize: 20, fontWeight: '800', marginBottom: 9 },
  sectionTitle: { fontSize: 20, lineHeight: 27, fontWeight: '800', color: '#183c32', marginBottom: 8 },
  sectionSubtitle: { fontSize: 15, fontWeight: '800', color: '#274c3d', marginTop: 18, marginBottom: 10 },
  muted: { color: '#64736a', fontSize: 14, lineHeight: 21, marginBottom: 9 },
  empty: { textAlign: 'center', color: '#77837b', paddingVertical: 24 },
  button: { backgroundColor: '#235b48', borderRadius: 12, minHeight: 48, paddingHorizontal: 16, paddingVertical: 13, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  buttonSecondary: { backgroundColor: '#edf3ee', borderWidth: 1, borderColor: '#d7e2d8' },
  buttonDisabled: { opacity: 0.48 },
  pressed: { opacity: 0.82 },
  buttonText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  buttonSecondaryText: { color: '#235b48' },
  buttonRow: { gap: 8, marginTop: 7 },
  fieldWrap: { marginTop: 13 },
  label: { color: '#30483a', fontSize: 13, fontWeight: '800', marginTop: 13, marginBottom: 7 },
  input: { color: '#1f3028', backgroundColor: '#fbfcfa', borderWidth: 1, borderColor: '#dce4dc', borderRadius: 11, minHeight: 48, paddingHorizontal: 13, fontSize: 15 },
  textArea: { height: 100, paddingTop: 12, textAlignVertical: 'top' },
  readOnlyInput: { backgroundColor: '#eef1ed', color: '#657168' },
  authScroll: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  authCard: { backgroundColor: '#ffffff', padding: 23, borderRadius: 22, borderWidth: 1, borderColor: '#e1e8e0' },
  brandMark: { width: 52, height: 52, borderRadius: 16, backgroundColor: '#183c32', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  brandMarkText: { color: '#ffffff', fontSize: 28, fontWeight: '800' },
  brandTitle: { color: '#183c32', fontSize: 20, fontWeight: '800' },
  brandSubTitle: { color: '#76847a', fontSize: 10, letterSpacing: 2.2, fontWeight: '800', marginTop: 3 },
  welcomeTitle: { color: '#183c32', fontSize: 28, fontWeight: '800', marginTop: 28, marginBottom: 8 },
  authFoot: { color: '#738078', lineHeight: 20, textAlign: 'center', marginTop: 18, fontSize: 12 },
  notice: { backgroundColor: '#edf4ee', color: '#2b6549', padding: 11, borderRadius: 10, marginVertical: 9, lineHeight: 20 },
  error: { color: '#a73532', backgroundColor: '#fff0ef', padding: 11, borderRadius: 10, marginTop: 10, lineHeight: 20 },
  noticeBanner: { backgroundColor: '#e8f3e9', color: '#2d674a', borderRadius: 12, padding: 12, lineHeight: 19, overflow: 'hidden' },
  errorBanner: { backgroundColor: '#ffefee', color: '#a43732', borderRadius: 12, padding: 12, lineHeight: 19, marginHorizontal: 16, marginTop: 12, overflow: 'hidden' },
  warning: { color: '#874d12', lineHeight: 21, fontWeight: '700' },
  infoRow: { paddingVertical: 11, borderBottomColor: '#edf0eb', borderBottomWidth: 1 },
  infoLabel: { color: '#78837c', fontSize: 12, fontWeight: '700' },
  infoValue: { color: '#283a30', fontSize: 15, fontWeight: '700', marginTop: 4 },
  record: { borderTopWidth: 1, borderTopColor: '#edf0eb', paddingTop: 15, marginTop: 15 },
  recordTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  recordTitle: { color: '#263b30', fontSize: 16, fontWeight: '800', flexShrink: 1, marginBottom: 5 },
  pill: { alignSelf: 'flex-start', overflow: 'hidden', borderRadius: 100, paddingVertical: 5, paddingHorizontal: 9, fontSize: 11, fontWeight: '800', textTransform: 'capitalize' },
  pillSuccess: { backgroundColor: '#e2f2e5', color: '#2c714b' },
  pillPending: { backgroundColor: '#fff4dc', color: '#936817' },
  pillMuted: { backgroundColor: '#edf0ed', color: '#606c63' },
  cancelButton: { alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 11, marginTop: 7 },
  cancelText: { color: '#a13f37', fontWeight: '800' },
  backLink: { color: '#2d6b50', fontWeight: '800', paddingBottom: 12 },
  noticeBox: { backgroundColor: '#f2f6f1', borderRadius: 13, borderWidth: 1, borderColor: '#e1e8e0', padding: 13, marginTop: 13 },
  noticeBoxTitle: { color: '#294c3a', fontWeight: '800', fontSize: 15, marginBottom: 5 },
  pickerButton: { minHeight: 54, borderRadius: 12, borderWidth: 1, borderColor: '#dce4dc', backgroundColor: '#fbfcfa', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 },
  pickerValue: { color: '#21392e', fontWeight: '800', fontSize: 16 },
  pickerHint: { color: '#6d8173', fontWeight: '700', fontSize: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8, marginBottom: 5 },
  chip: { borderRadius: 100, borderWidth: 1, borderColor: '#d7e2d8', backgroundColor: '#fbfcfa', paddingVertical: 9, paddingHorizontal: 12 },
  chipSelected: { backgroundColor: '#235b48', borderColor: '#235b48' },
  chipDisabled: { backgroundColor: '#f0f1ef', borderColor: '#e3e5e1' },
  chipText: { color: '#456052', fontSize: 13, fontWeight: '700' },
  chipTextSelected: { color: '#ffffff' },
  chipTextDisabled: { color: '#9aa29b', textDecorationLine: 'line-through' },
  seatGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  seat: { width: 43, height: 43, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#c9ddcf', backgroundColor: '#edf5ef' },
  seatSelected: { backgroundColor: '#235b48', borderColor: '#235b48' },
  seatDisabled: { backgroundColor: '#edf0ed', borderColor: '#e1e4e1' },
  seatText: { color: '#285440', fontWeight: '800' },
  seatTextSelected: { color: '#ffffff' },
  seatTextDisabled: { color: '#a0a7a1' },
  selectedSeatText: { color: '#2c6749', fontSize: 13, fontWeight: '800', marginTop: 5, marginBottom: 8 },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#e7ece6', marginTop: 18, paddingTop: 8 },
  amount: { color: '#173e31', fontSize: 20, fontWeight: '900' },
  success: { color: '#2b7049', fontWeight: '800', paddingTop: 10 },
  metricGridItem: { flex: 1 },
  tabBar: { flexDirection: 'row', backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: '#e1e7e1', paddingTop: 8, paddingBottom: Platform.OS === 'android' ? 10 : 6 },
  tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  tabText: { color: '#78847b', fontSize: 12, fontWeight: '700' },
  tabTextSelected: { color: '#235b48', fontWeight: '900' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
});

