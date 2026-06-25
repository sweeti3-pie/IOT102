// ─────────────────────────────────────────────────────────────────
//  firebase-config.js
//  Replace the values below with YOUR Firebase project credentials.
//  Find them at: Firebase Console → Project Settings → Your apps
// ─────────────────────────────────────────────────────────────────

// Import the functions you need from the SDKs you need
// import { initializeApp } from "firebase/app";
// import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDirXPBoBVBCdclYLz3za_OFW4xwB_gjts",
  authDomain: "iot102-9491e.firebaseapp.com",
  databaseURL: "https://iot102-9491e-default-rtdb.firebaseio.com",
  projectId: "iot102-9491e",
  storageBucket: "iot102-9491e.firebasestorage.app",
  messagingSenderId: "832422052530",
  appId: "1:832422052530:web:cbe2ce4d71c50dd9d33fab",
  measurementId: "G-7WXYYJM6R8"
};

// Initialize Firebase
// const app = initializeApp(firebaseConfig);
// const analytics = getAnalytics(app);

// Khởi tạo Firebase trực tiếp không dùng import
firebase.initializeApp(firebaseConfig);

// ─────────────────────────────────────────────────────────────────
//  Realtime Database structure (matches main.cpp exactly):
//
//  (root)/
//  ├── sensors/
//  │   ├── temperature   (float)    °C from DHT11
//  │   ├── humidity      (float)    % from DHT11
//  │   ├── gas           (int)      100 = safe, 850 = danger (MQ2)
//  │   ├── ldr           (int)      0–4095 raw ADC (ESP32 analog)
//  │   ├── rain          (bool)     true = rain detected
//  │   └── human         (bool)     true = motion detected (PIR)
//  │
//  └── controls/
//      ├── fan           (bool)     true = fan ON
//      ├── fanSpeed      (int)      0–100 percent
//      ├── light         (bool)     true = light ON
//      └── awning        (string)   "open" or "closed"
//
//  ESP32 (main.cpp) writes to sensors/* every 2 seconds.
//  Web dashboard writes to controls/* when user toggles a device.
//  ESP32 reads controls/* every 500ms and acts accordingly.
// ─────────────────────────────────────────────────────────────────
