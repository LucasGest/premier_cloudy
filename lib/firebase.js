const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Même projet Firebase que le bot ; les données du site vivent sous
// premierStrats/{maps|compos|matchs}/items.
function db() {
  if (getApps().length === 0) {
    let key = (process.env.FIREBASE_PRIVATE_KEY || '').trim();
    if (/^(['"]).*\1$/s.test(key)) key = key.slice(1, -1);
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: key.replace(/\\n/g, '\n')
      })
    });
  }
  return getFirestore();
}

function items(collection) {
  return db().collection('premierStrats').doc(collection).collection('items');
}

module.exports = { items, db };
