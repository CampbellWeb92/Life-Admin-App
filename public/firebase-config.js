// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyC1V2_68ZJUG5JyRaJwBI-fWN2v2dHd_fU",
  authDomain: "admin-life-933ff.firebaseapp.com",
  projectId: "admin-life-933ff",
  storageBucket: "admin-life-933ff.firebasestorage.app",
  messagingSenderId: "749564228746",
  appId: "1:749564228746:web:bd68d5ecc463b6f383a973",
  measurementId: "G-0BDFYPRKMY"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);