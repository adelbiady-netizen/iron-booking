import {
  LegalLayout, LegalH1, LegalUpdated, LegalDisclaimer,
  LegalSection, LegalP, LegalUl, LegalA, LegalDivider,
} from './LegalLayout';

const UPDATED_EN = 'Last updated: May 12, 2026';
const UPDATED_HE = 'עודכן לאחרונה: 12 במאי 2026';

export default function AccessibilityPage() {
  return (
    <LegalLayout titleEn="Accessibility Statement" titleHe="הצהרת נגישות">
      {(isHebrew) => isHebrew ? <Hebrew /> : <English />}
    </LegalLayout>
  );
}

// ─── English ──────────────────────────────────────────────────────────────────

function English() {
  return (
    <>
      <LegalH1>Accessibility Statement</LegalH1>
      <LegalUpdated>{UPDATED_EN}</LegalUpdated>
      <LegalDisclaimer isHebrew={false} />

      <LegalSection id="commitment" title="Our Commitment" />
      <LegalP>
        PC Iron Ltd. is committed to ensuring that Iron Booking is accessible to all users,
        including people with disabilities. We aim to conform to the{' '}
        <strong>Web Content Accessibility Guidelines (WCAG) 2.1, Level AA</strong> and to comply
        with the Israeli Equal Rights for People with Disabilities Law (5758-1998) and its
        accessibility regulations.
      </LegalP>

      <LegalSection id="measures" title="Measures We Have Taken" />
      <LegalP>
        The Iron Booking guest-facing platform has been built with the following accessibility
        measures:
      </LegalP>
      <LegalUl items={[
        'Semantic HTML5 structure with proper heading hierarchy',
        'ARIA labels and roles on all interactive elements',
        'Full keyboard navigation support — no mouse required',
        'Sufficient colour contrast ratios between text and background',
        'Focus-visible styles on all focusable elements',
        'Right-to-left (RTL) layout support for Hebrew users',
        'Responsive, mobile-first design that adapts across screen sizes',
        'No content that flashes more than three times per second',
        'Form inputs with visible labels and descriptive placeholder text',
        'Error messages that are clearly associated with the relevant field',
        'All images have appropriate alt text or aria-hidden for decorative images',
      ]} />

      <LegalSection id="limitations" title="Known Limitations" />
      <LegalP>
        While we strive for full accessibility, some areas may not yet be fully conformant.
        We are actively working to improve:
      </LegalP>
      <LegalUl items={[
        'Complex interactive components such as date selectors and slot grids',
        'Dynamic content updates announced to screen readers in all scenarios',
        'Third-party embedded components (e.g., map links) which are outside our control',
      ]} />

      <LegalSection id="feedback" title="Feedback & Assistance" />
      <LegalP>
        If you experience any difficulty accessing any part of the Iron Booking platform, or if
        you require content in an alternative format, please contact us:
      </LegalP>
      <LegalUl items={[
        <span key="email">Email: <LegalA href="mailto:info@iron-pos.com">info@iron-pos.com</LegalA></span>,
        'Company: PC Iron Ltd., Khayat 6, Haifa, Israel',
      ]} />
      <LegalP>
        We aim to respond to accessibility inquiries within 5 business days.
      </LegalP>

      <LegalSection id="enforcement" title="Enforcement" />
      <LegalP>
        If you are not satisfied with our response, you may contact the Israeli Commission for Equal
        Rights of Persons with Disabilities at the Ministry of Justice.
      </LegalP>

      <LegalDivider />
      <LegalP>
        <LegalA href="/privacy">Privacy Policy</LegalA>
        {' · '}
        <LegalA href="/terms">Terms of Service</LegalA>
        {' · '}
        <LegalA href="/contact">Contact & Support</LegalA>
      </LegalP>
    </>
  );
}

// ─── Hebrew ───────────────────────────────────────────────────────────────────

function Hebrew() {
  return (
    <>
      <LegalH1>הצהרת נגישות</LegalH1>
      <LegalUpdated>{UPDATED_HE}</LegalUpdated>
      <LegalDisclaimer isHebrew />

      <LegalSection id="commitment" title="המחויבות שלנו" />
      <LegalP>
        פי סי איירון בע"מ מחויבת להבטיח שפלטפורמת Iron Booking תהיה נגישה לכל המשתמשים,
        כולל אנשים עם מוגבלויות. אנו שואפים לעמוד בתקן{' '}
        <strong>WCAG 2.1, רמה AA</strong>{' '}
        ולציית לחוק שוויון זכויות לאנשים עם מוגבלות, תשנ"ח-1998 ולתקנות הנגישות שלו.
      </LegalP>

      <LegalSection id="measures" title="הצעדים שנקטנו" />
      <LegalP>
        פלטפורמת Iron Booking הפונה לאורחים נבנתה עם אמצעי הנגישות הבאים:
      </LegalP>
      <LegalUl items={[
        'מבנה HTML5 סמנטי עם היררכיית כותרות תקינה',
        'תוויות ARIA ותפקידים על כל האלמנטים האינטראקטיביים',
        'תמיכה מלאה בניווט מקלדת — ללא צורך בעכבר',
        'יחסי ניגודיות צבע מספקים בין טקסט לרקע',
        'סגנונות focus-visible על כל האלמנטים הניתנים לפוקוס',
        'תמיכה בפריסת ימין-לשמאל (RTL) למשתמשי עברית',
        'עיצוב רספונסיבי, mobile-first המתאים לגדלי מסך שונים',
        'אין תוכן המהבהב יותר משלוש פעמים בשנייה',
        'שדות קלט עם תוויות גלויות וטקסט placeholder תיאורי',
        'הודעות שגיאה המשויכות בבירור לשדה הרלוונטי',
        'כל התמונות כוללות טקסט alt מתאים או aria-hidden לתמונות דקורטיביות',
      ]} />

      <LegalSection id="limitations" title="מגבלות ידועות" />
      <LegalP>
        למרות שאנו שואפים לנגישות מלאה, ייתכן שחלק מהאזורים עדיין אינם עומדים
        בתקן במלואו. אנו עובדים באופן פעיל לשיפור:
      </LegalP>
      <LegalUl items={[
        'רכיבים אינטראקטיביים מורכבים כגון בוחרי תאריכים ורשתות תורים',
        'עדכוני תוכן דינמיים שיוכרזו לקוראי מסך בכל התרחישים',
        'רכיבי צד שלישי מוטמעים (לדוגמה, קישורי מפה) שאינם בשליטתנו',
      ]} />

      <LegalSection id="feedback" title="משוב וסיוע" />
      <LegalP>
        אם נתקלת בקושי כלשהו בגישה לחלק כלשהו מפלטפורמת Iron Booking, או אם אתה
        זקוק לתוכן בפורמט חלופי, אנא פנה אלינו:
      </LegalP>
      <LegalUl items={[
        <span key="email">דוא"ל: <LegalA href="mailto:info@iron-pos.com">info@iron-pos.com</LegalA></span>,
        'חברה: פי סי איירון בע"מ, חיית 6, חיפה, ישראל',
      ]} />
      <LegalP>
        אנו שואפים להגיב לפניות נגישות תוך 5 ימי עסקים.
      </LegalP>

      <LegalSection id="enforcement" title="אכיפה" />
      <LegalP>
        אם אינך מרוצה מתגובתנו, ניתן לפנות לנציבות שוויון זכויות לאנשים עם מוגבלות
        במשרד המשפטים.
      </LegalP>

      <LegalDivider />
      <LegalP>
        <LegalA href="/privacy">מדיניות פרטיות</LegalA>
        {' · '}
        <LegalA href="/terms">תנאי שירות</LegalA>
        {' · '}
        <LegalA href="/contact">צור קשר ותמיכה</LegalA>
      </LegalP>
    </>
  );
}
