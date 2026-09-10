export type Locale = "en" | "hi" | "ar";
export type TextDirection = "ltr" | "rtl";
export type MessageKey = "appName" | "openVault" | "noVault" | "settings" | "privacyTitle" | "localDiagnostics" | "localDiagnosticsDescription" | "editorMode" | "source" | "livePreview" | "reading";

const CATALOG: Record<Locale, Record<MessageKey, string>> = {
  en: {
    appName: "OpenObsidian",
    openVault: "Open vault",
    noVault: "No vault selected.",
    settings: "Settings",
    privacyTitle: "Privacy and diagnostics",
    localDiagnostics: "Show local diagnostics manifest",
    localDiagnosticsDescription: "Diagnostics stay on this device and exclude note content, provider secrets and absolute paths.",
    editorMode: "Editor mode",
    source: "Source",
    livePreview: "Live preview",
    reading: "Reading",
  },
  hi: {
    appName: "OpenObsidian",
    openVault: "वॉल्ट खोलें",
    noVault: "कोई वॉल्ट चयनित नहीं है।",
    settings: "सेटिंग्स",
    privacyTitle: "गोपनीयता और निदान",
    localDiagnostics: "स्थानीय निदान मेनिफेस्ट दिखाएँ",
    localDiagnosticsDescription: "निदान इसी डिवाइस पर रहता है और नोट सामग्री, प्रदाता सीक्रेट तथा पूर्ण पथ शामिल नहीं करता।",
    editorMode: "एडिटर मोड",
    source: "सोर्स",
    livePreview: "लाइव प्रीव्यू",
    reading: "रीडिंग",
  },
  ar: {
    appName: "OpenObsidian",
    openVault: "فتح الخزنة",
    noVault: "لم يتم اختيار خزنة.",
    settings: "الإعدادات",
    privacyTitle: "الخصوصية والتشخيص",
    localDiagnostics: "عرض بيان التشخيص المحلي",
    localDiagnosticsDescription: "يبقى التشخيص على هذا الجهاز ولا يتضمن محتوى الملاحظات أو أسرار المزوّد أو المسارات المطلقة.",
    editorMode: "وضع المحرر",
    source: "المصدر",
    livePreview: "المعاينة المباشرة",
    reading: "القراءة",
  },
};

export function normalizeLocale(value: string | undefined): Locale {
  const normalized = value?.toLocaleLowerCase().split(/[-_]/)[0];
  return normalized === "hi" || normalized === "ar" ? normalized : "en";
}

export function localeDirection(locale: Locale): TextDirection {
  return locale === "ar" ? "rtl" : "ltr";
}

export function message(locale: Locale, key: MessageKey): string {
  return CATALOG[locale][key];
}

export function localeMessages(locale: Locale): Readonly<Record<MessageKey, string>> {
  return CATALOG[locale];
}
