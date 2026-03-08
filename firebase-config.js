// ============================================================
// BEATFORGE - Firebase Configuration
// ============================================================
// Replace values below with YOUR Firebase project config.
// Get from: console.firebase.google.com
// → Project Settings → Your apps → </> Web app
//
// App works in Guest mode automatically if not configured.
// ============================================================

var FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_AUTH_DOMAIN",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

// Safe init — do not edit below
var FIREBASE_READY = false;
var db   = null;
var auth = null;

(function() {
  try {
    if (!FIREBASE_CONFIG.apiKey || FIREBASE_CONFIG.apiKey === 'YOUR_API_KEY') {
      console.info('BeatForge: Firebase not configured — Guest mode.');
      return;
    }
    if (typeof firebase === 'undefined') {
      console.warn('BeatForge: Firebase SDK missing — Guest mode.');
      return;
    }
    firebase.initializeApp(FIREBASE_CONFIG);
    db   = firebase.firestore();
    auth = firebase.auth();
    FIREBASE_READY = true;
    console.info('BeatForge: Firebase ready ✓');
  } catch(e) {
    console.warn('BeatForge: Firebase init failed —', e.message);
    FIREBASE_READY = false; db = null; auth = null;
  }
})();
