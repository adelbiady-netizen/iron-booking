import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const savedLanguage = localStorage.getItem("iron_booking_language") || "he";

i18n.use(initReactI18next).init({
  resources: {
    en: {
      translation: {
        title: "Iron Booking",
        subtitle: "Drag and drop tables to change their position on the floor board.",
        reloadTables: "Reload Tables",
        restaurantId: "Restaurant ID",
        loadingTables: "Loading tables...",
        noTablesFound: "No tables found",
        capacity: "Capacity",
        x: "X",
        y: "Y",
        switchToEnglish: "English",
        switchToHebrew: "עברית",
      },
    },
    he: {
      translation: {
        title: "איירון בוקינג",
        subtitle: "גרור ושחרר שולחנות כדי לשנות את המיקום שלהם על גבי מפת המסעדה.",
        reloadTables: "טען שולחנות מחדש",
        restaurantId: "מזהה מסעדה",
        loadingTables: "טוען שולחנות...",
        noTablesFound: "לא נמצאו שולחנות",
        capacity: "קיבולת",
        x: "ציר X",
        y: "ציר Y",
        switchToEnglish: "English",
        switchToHebrew: "עברית",
      },
    },
  },
  lng: savedLanguage,
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

i18n.on("languageChanged", (lng) => {
  localStorage.setItem("iron_booking_language", lng);

  document.documentElement.lang = lng;
  document.documentElement.dir = lng === "he" ? "rtl" : "ltr";
});

document.documentElement.lang = i18n.language;
document.documentElement.dir = i18n.language === "he" ? "rtl" : "ltr";

export default i18n;