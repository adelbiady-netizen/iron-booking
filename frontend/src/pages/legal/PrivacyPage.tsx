import {
  LegalLayout, LegalH1, LegalUpdated, LegalDisclaimer,
  LegalSection, LegalP, LegalUl, LegalA, LegalDivider,
} from './LegalLayout';

const UPDATED_EN = 'Last updated: May 12, 2026';
const UPDATED_HE = 'עודכן לאחרונה: 12 במאי 2026';

export default function PrivacyPage() {
  return (
    <LegalLayout titleEn="Privacy Policy" titleHe="מדיניות פרטיות">
      {(isHebrew) => isHebrew ? <Hebrew /> : <English />}
    </LegalLayout>
  );
}

// ─── English ──────────────────────────────────────────────────────────────────

function English() {
  return (
    <>
      <LegalH1>Privacy Policy</LegalH1>
      <LegalUpdated>{UPDATED_EN}</LegalUpdated>
      <LegalDisclaimer isHebrew={false} />

      <LegalSection id="intro" title="1. Introduction" />
      <LegalP>
        Iron Booking is an online restaurant reservation and waitlist management platform operated by{' '}
        <strong>PC Iron Ltd.</strong> ("Iron Booking", "we", "our", or "us"), registered in Israel.
        This Privacy Policy explains how we collect, use, and protect your personal information when
        you make a reservation or join a waitlist through our platform.
      </LegalP>

      <LegalSection id="data-collected" title="2. Information We Collect" />
      <LegalP>When you make a reservation or join a waitlist we collect:</LegalP>
      <LegalUl items={[
        'Full name',
        'Phone number',
        'Email address (if provided)',
        'Party size and requested date/time',
        'Occasion (e.g., birthday, anniversary)',
        'Special requests or notes you choose to share',
        'Language preference',
      ]} />
      <LegalP>
        We do not collect payment card details at this time. If a restaurant enables deposit or
        payment features in the future, payment processing will be handled by a certified third-party
        payment processor, and this policy will be updated accordingly.
      </LegalP>

      <LegalSection id="how-we-use" title="3. How We Use Your Information" />
      <LegalP>We use the information you provide to:</LegalP>
      <LegalUl items={[
        'Create and manage your reservation or waitlist entry',
        'Send reservation confirmations, reminders, and updates via WhatsApp or SMS',
        'Notify you of cancellations, waitlist availability, or status changes',
        'Allow the restaurant to manage their seating and operations',
        'Respond to support requests',
      ]} />

      <LegalSection id="sms-whatsapp" title="4. WhatsApp & SMS Communications" />
      <LegalP>
        By submitting a reservation or joining a waitlist through Iron Booking, you consent to
        receive transactional messages related to your booking via WhatsApp and/or SMS. These
        messages may include: reservation confirmations, reminders, late-arrival notifications,
        cancellation notices, and waitlist updates.
      </LegalP>
      <LegalP>
        We do not send unsolicited marketing messages. You may contact us at{' '}
        <LegalA href="mailto:info@iron-pos.com">info@iron-pos.com</LegalA> to opt out of
        future communications.
      </LegalP>

      <LegalSection id="sharing" title="5. Information Sharing" />
      <LegalP>
        Your personal information is shared with the specific restaurant you are booking with, solely
        for the purpose of managing your reservation. Restaurants operate their accounts independently
        and are responsible for handling your data in accordance with applicable law.
      </LegalP>
      <LegalP>We do not sell, rent, or trade your personal information to third parties.</LegalP>
      <LegalP>
        We may share information with service providers who support our operations (e.g., messaging
        infrastructure), under strict data processing agreements.
      </LegalP>

      <LegalSection id="retention" title="6. Data Retention" />
      <LegalP>
        We retain your personal information for as long as necessary to provide the service and for
        reasonable operational and legal purposes. Reservation data is typically retained for up to
        24 months. You may request deletion at any time.
      </LegalP>

      <LegalSection id="rights" title="7. Your Rights" />
      <LegalP>
        Under applicable Israeli privacy law, you have the right to access, correct, or request
        deletion of personal information we hold about you. To exercise these rights, contact us at{' '}
        <LegalA href="mailto:info@iron-pos.com">info@iron-pos.com</LegalA>.
      </LegalP>

      <LegalSection id="security" title="8. Security" />
      <LegalP>
        We implement reasonable technical and organisational measures to protect your data. However,
        no system is completely secure and we cannot guarantee absolute security.
      </LegalP>

      <LegalSection id="changes" title="9. Changes to This Policy" />
      <LegalP>
        We may update this policy from time to time. Material changes will be reflected with a
        revised "Last updated" date. Continued use of the platform after changes constitutes
        acceptance of the updated policy.
      </LegalP>

      <LegalSection id="contact" title="10. Contact" />
      <LegalP>
        PC Iron Ltd. · Khayat 6, Haifa, Israel ·{' '}
        <LegalA href="mailto:info@iron-pos.com">info@iron-pos.com</LegalA>
      </LegalP>

      <LegalDivider />
      <LegalP>
        <LegalA href="/terms">Terms of Service</LegalA>
        {' · '}
        <LegalA href="/accessibility">Accessibility Statement</LegalA>
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
      <LegalH1>מדיניות פרטיות</LegalH1>
      <LegalUpdated>{UPDATED_HE}</LegalUpdated>
      <LegalDisclaimer isHebrew />

      <LegalSection id="intro" title="1. מבוא" />
      <LegalP>
        Iron Booking הינה פלטפורמה מקוונת לניהול הזמנות מסעדה ורשימות המתנה, המופעלת על ידי{' '}
        <strong>פי סי איירון בע"מ</strong> ("Iron Booking", "אנחנו"), חברה רשומה בישראל.
        מדיניות פרטיות זו מסבירה כיצד אנו אוספים, משתמשים ומגנים על המידע האישי שלך
        בעת ביצוע הזמנה או הצטרפות לרשימת המתנה דרך הפלטפורמה שלנו.
      </LegalP>

      <LegalSection id="data-collected" title="2. המידע שאנו אוספים" />
      <LegalP>בעת ביצוע הזמנה או הצטרפות לרשימת המתנה, אנו אוספים:</LegalP>
      <LegalUl items={[
        'שם מלא',
        'מספר טלפון',
        'כתובת דוא"ל (אם סופקה)',
        'מספר סועדים, תאריך ושעה מבוקשים',
        'אירוע (לדוגמה: יום הולדת, יום נישואין)',
        'בקשות מיוחדות או הערות שבחרת לשתף',
        'העדפת שפה',
      ]} />
      <LegalP>
        איננו אוספים פרטי כרטיס אשראי בשלב זה. אם מסעדה תפעיל בעתיד תכונות הפקדה
        או תשלום, עיבוד התשלום יתבצע על ידי ספק תשלומים מוסמך צד שלישי, ומדיניות זו
        תעודכן בהתאם.
      </LegalP>

      <LegalSection id="how-we-use" title="3. כיצד אנו משתמשים במידע שלך" />
      <LegalP>אנו משתמשים במידע שאתה מספק כדי:</LegalP>
      <LegalUl items={[
        'ליצור ולנהל את ההזמנה שלך או את רשומת רשימת ההמתנה',
        'לשלוח אישורי הזמנה, תזכורות ועדכונים בווטסאפ או SMS',
        'להודיע לך על ביטולים, זמינות ברשימת ההמתנה או שינויי סטטוס',
        'לאפשר למסעדה לנהל את הסידורים והפעילות שלה',
        'להגיב לפניות תמיכה',
      ]} />

      <LegalSection id="sms-whatsapp" title="4. תקשורת בווטסאפ ו-SMS" />
      <LegalP>
        בהגשת הזמנה או הצטרפות לרשימת המתנה דרך Iron Booking, אתה מסכים לקבל
        הודעות עסקיות הקשורות להזמנה שלך דרך ווטסאפ ו/או SMS. ההודעות עשויות לכלול:
        אישורי הזמנה, תזכורות, הודעות על איחור, הודעות ביטול ועדכוני רשימת המתנה.
      </LegalP>
      <LegalP>
        אנו לא שולחים הודעות שיווקיות שלא התבקשו. ניתן לפנות אלינו בכתובת{' '}
        <LegalA href="mailto:info@iron-pos.com">info@iron-pos.com</LegalA> כדי לבטל הסכמה
        לתקשורת עתידית.
      </LegalP>

      <LegalSection id="sharing" title="5. שיתוף מידע" />
      <LegalP>
        המידע האישי שלך משותף עם המסעדה הספציפית שאצלה ביצעת הזמנה, אך ורק לצורך
        ניהול ההזמנה. המסעדות מפעילות את חשבונותיהן באופן עצמאי ואחראיות לטיפול
        במידע שלך בהתאם לחוק החל.
      </LegalP>
      <LegalP>אנו לא מוכרים, משכירים או סוחרים במידע האישי שלך לצדדים שלישיים.</LegalP>
      <LegalP>
        אנו עשויים לשתף מידע עם ספקי שירות התומכים בפעילות שלנו (לדוגמה, תשתית
        הודעות), תחת הסכמי עיבוד נתונים מחמירים.
      </LegalP>

      <LegalSection id="retention" title="6. שמירת נתונים" />
      <LegalP>
        אנו שומרים את המידע האישי שלך כל עוד הדבר נחוץ למתן השירות ולצרכים תפעוליים
        ומשפטיים סבירים. נתוני הזמנות נשמרים בדרך כלל עד 24 חודשים. ניתן לבקש מחיקה
        בכל עת.
      </LegalP>

      <LegalSection id="rights" title="7. הזכויות שלך" />
      <LegalP>
        בהתאם לחוק הגנת הפרטיות הישראלי, יש לך זכות לגשת, לתקן או לבקש מחיקת מידע
        אישי שאנו מחזיקים עליך. לממש זכויות אלה, פנה אלינו בכתובת{' '}
        <LegalA href="mailto:info@iron-pos.com">info@iron-pos.com</LegalA>.
      </LegalP>

      <LegalSection id="security" title="8. אבטחה" />
      <LegalP>
        אנו מיישמים אמצעים טכניים וארגוניים סבירים להגנה על המידע שלך. עם זאת, אין
        מערכת בטוחה לחלוטין ואיננו יכולים להבטיח אבטחה מוחלטת.
      </LegalP>

      <LegalSection id="changes" title="9. שינויים במדיניות זו" />
      <LegalP>
        אנו עשויים לעדכן מדיניות זו מעת לעת. שינויים מהותיים יבואו לידי ביטוי בתאריך
        "עודכן לאחרונה" מעודכן. המשך השימוש בפלטפורמה לאחר השינויים מהווה הסכמה
        למדיניות המעודכנת.
      </LegalP>

      <LegalSection id="contact" title="10. יצירת קשר" />
      <LegalP>
        פי סי איירון בע"מ · חיית 6, חיפה, ישראל ·{' '}
        <LegalA href="mailto:info@iron-pos.com">info@iron-pos.com</LegalA>
      </LegalP>

      <LegalDivider />
      <LegalP>
        <LegalA href="/terms">תנאי שירות</LegalA>
        {' · '}
        <LegalA href="/accessibility">נגישות</LegalA>
        {' · '}
        <LegalA href="/contact">צור קשר ותמיכה</LegalA>
      </LegalP>
    </>
  );
}
