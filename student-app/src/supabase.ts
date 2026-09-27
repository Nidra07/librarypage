import { AppState, Platform } from 'react-native';
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// This publishable key is intended for client apps. Row-level security and the
// database RPCs enforce each student's permissions; never put a service-role key here.
const supabaseUrl = 'https://hcimcqktnzukbhtiucvk.supabase.co';
const supabasePublishableKey = 'sb_publishable_cotGlqaEnyPUz-DhUCgM1A_sfqLMldb';

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    ...(Platform.OS !== 'web' ? { storage: AsyncStorage } : {}),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});


