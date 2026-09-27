# Peaceful Pages Student app

Android student app for The Peaceful Pages library. It uses the existing Supabase Auth account and student policies.

## Student features

- Sign in only; account creation and the one-time offline-admission registration stay on the website.
- A session is saved on the device so students normally remain signed in.
- See student status, admission number, payments, payment verification and allocated monthly seat.
- Submit monthly payments using the shared UPI ID or cash at the library. Monthly payment requires a vacant seat selection; the seat is held while the administrator reviews payment and allocated after confirmation.
- View bookings, choose a date, duration and entry time, create bookings after required fees are verified, and cancel future confirmed bookings.
- View and edit name, phone and address. Email and admission number are read-only.
- Attendance and all admin tools remain on the website.

Only the Supabase publishable key is included in the app. The database RLS policies and student-specific RPCs enforce access; never use a service-role key in a client app.

## Build

The GitHub Actions workflow `.github/workflows/build-student-portal-apk.yml` creates a signed Android APK when the student app changes. After a successful build it publishes the APK as the `student-portal.apk` asset on the repository's latest GitHub Release. The website exposes the download link only in authenticated student pages.

Students can also build locally with Node.js 22 and Android Studio installed:

```sh
npm install
npx expo install @react-native-community/datetimepicker
npx expo install react-native-safe-area-context
npx expo prebuild --platform android
cd android
./gradlew assembleRelease
```

The APK output is `android/app/build/outputs/apk/release/app-release.apk`.



