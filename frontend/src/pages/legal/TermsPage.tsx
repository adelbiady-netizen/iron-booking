import {
  LegalLayout, LegalH1, LegalUpdated, LegalDisclaimer,
  LegalSection, LegalP, LegalUl, LegalA, LegalDivider,
} from './LegalLayout';

const UPDATED_EN = 'Last updated: May 12, 2026';
const UPDATED_HE = 'עודכן לאחרונה: 12 במאי 2026';

export default function TermsPage() {
  return (
    <LegalLayout titleEn="Terms of Service" titleHe="תנאי שירות">
      {(isHebrew) => isHebrew ? <Hebrew /> : <English />}
    </LegalLayout>
  );
}

// ─── English ──────────────────────────────────────────────────────────────────

function English() {
  return (
    <>
      <LegalH1>Terms of Service</LegalH1>
      <LegalUpdated>{UPDATED_EN}</LegalUpdated>
      <LegalDisclaimer isHebrew={false} />

      <LegalSection id="intro" title="1. About Iron Booking" />
      <LegalP>
        Iron Booking is a reservation and waitlist management platform operated by{' '}
        <strong>PC Iron Ltd.</strong>, Khayat 6, Haifa, Israel. By using Iron Booking to make a
        reservation or join a waitlist, you agree to these Terms of Service.
      </LegalP>
      <LegalP>
        Iron Booking is a technology platform. The restaurant is the service provider. The actual
        dining experience, staffing, menu, pricing, and policies are the exclusive responsibility
        of the restaurant, not Iron Booking.
      </LegalP>

      <LegalSection id="reservations" title="2. Making a Reservation" />
      <LegalP>
        When you submit a reservation request through Iron Booking, you are requesting a table at
        the relevant restaurant. Depending on the restaurant's settings, your reservation may be:
      </LegalP>
      <LegalUl items={[
        'Automatically confirmed upon submission, or',
        'Pending confirmation by the restaurant staff.',
      ]} />
      <LegalP>
        You will receive a confirmation via WhatsApp or SMS. A reservation is only confirmed once
        you receive an explicit confirmation message.
      </LegalP>

      <LegalSection id="guest-obligations" title="3. Guest Obligations" />
      <LegalP>You agree to:</LegalP>
      <LegalUl items={[
        'Provide accurate contact information and party size',
        'Arrive at or near your reserved time',
        'Notify the restaurant as early as possible if you cannot attend',
        'Treat restaurant staff and other guests with respect',
      ]} />

      <LegalSection id="cancellation" title="4. Cancellations & No-shows" />
      <LegalP>
        Cancellation and no-show policies are set individually by each restaurant. Some restaurants
        may require advance notice before cancellation and may charge a fee for late cancellations
        or no-shows. The restaurant's applicable policy is displayed before you complete your
        reservation.
      </LegalP>
      <LegalP>
        <strong>Deposits and cancellation fees:</strong> These features are not currently active on
        the platform. If a restaurant enables deposit or cancellation-fee functionality in the
        future, the relevant terms will be clearly presented to you before you confirm your
        reservation, and your payment data will be processed by a certified third-party payment
        provider.
      </LegalP>

      <LegalSection id="waitlist" title="5. Waitlist" />
      <LegalP>
        Joining a waitlist does not guarantee a table. If a table becomes available, the restaurant
        or the platform will contact you. Availability is not reserved until you receive an explicit
        confirmation.
      </LegalP>

      <LegalSection id="communications" title="6. Communications" />
      <LegalP>
        By making a reservation or joining a waitlist, you consent to receive transactional
        WhatsApp and/or SMS messages related to your booking. These messages include confirmations,
        reminders, late-arrival notifications, cancellation notices, and waitlist updates. You may
        opt out by contacting{' '}
        <LegalA href="mailto:info@iron-pos.com">info@iron-pos.com</LegalA>.
      </LegalP>

      <LegalSection id="liability" title="7. Limitation of Liability" />
      <LegalP>
        Iron Booking acts solely as a technology intermediary between guests and restaurants. We are
        not responsible for the quality of the dining experience, availability of tables, restaurant
        closures, or any actions or omissions by the restaurant.
      </LegalP>
      <LegalP>
        To the maximum extent permitted by applicable law, PC Iron Ltd. shall not be liable for any
        indirect, incidental, or consequential damages arising from use of the platform.
      </LegalP>

      <LegalSection id="changes" title="8. Changes to These Terms" />
      <LegalP>
        We may update these terms from time to time. The "Last updated" date at the top of this
        page will reflect any changes. Continued use of the platform after changes constitutes
        acceptance of the revised terms.
      </LegalP>

      <LegalSection id="governing-law" title="9. Governing Law" />
      <LegalP>
        These terms are governed by the laws of the State of Israel. Any disputes shall be subject
        to the exclusive jurisdiction of the competent courts in Haifa, Israel.
      </LegalP>

      <LegalSection id="contact" title="10. Contact" />
      <LegalP>
        PC Iron Ltd. · Khayat 6, Haifa, Israel ·{' '}
        <LegalA href="mailto:info@iron-pos.com">info@iron-pos.com</LegalA>
      </LegalP>

      <LegalDivider />
      <LegalP>
        <LegalA href="/privacy">Privacy Policy</LegalA>
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
      <LegalH1>תנאי שירות</LegalH1>
      <LegalUpdated>{UPDATED_HE}</LegalUpdated>
      <LegalDisclaimer isHebrew />

      <LegalSection id="intro" title="1. אודות Iron Booking" />
      <LegalP>
        Iron Booking היא פלטפורמת ניהול הזמנות ורשימות המתנה המופעלת על ידי{' '}
        <strong>פי סי איירון בע"מ</strong>, חיית 6, חיפה, ישראל. בשימוש ב-Iron Booking לביצוע
        הזמנה או הצטרפות לרשימת המתנה, אתה מסכים לתנאי שירות אלה.
      </LegalP>
      <LegalP>
        Iron Booking היא פלטפורמה טכנולוגית. המסעדה היא ספקית השירות. חוויית הסועד בפועל,
        כוח האדם, התפריט, התמחור והמדיניות הם באחריות המסעדה הבלעדית, לא של Iron Booking.
      </LegalP>

      <LegalSection id="reservations" title="2. ביצוע הזמנה" />
      <LegalP>
        בעת הגשת בקשת הזמנה דרך Iron Booking, אתה מבקש שולחן במסעדה הרלוונטית.
        בהתאם להגדרות המסעדה, ההזמנה שלך עשויה להיות:
      </LegalP>
      <LegalUl items={[
        'מאושרת אוטומטית עם ההגשה, או',
        'ממתינה לאישור על ידי צוות המסעדה.',
      ]} />
      <LegalP>
        תקבל אישור דרך ווטסאפ או SMS. הזמנה מאושרת רק לאחר שקיבלת הודעת אישור מפורשת.
      </LegalP>

      <LegalSection id="guest-obligations" title="3. חובות האורח" />
      <LegalP>אתה מסכים:</LegalP>
      <LegalUl items={[
        'לספק פרטי קשר מדויקים ומספר סועדים נכון',
        'להגיע בזמן ההזמנה או בסמוך לו',
        'להודיע למסעדה מוקדם ככל האפשר אם אינך יכול להגיע',
        'להתייחס לצוות המסעדה ולסועדים אחרים בכבוד',
      ]} />

      <LegalSection id="cancellation" title="4. ביטולים ואי-הגעה" />
      <LegalP>
        מדיניות הביטול ואי-ההגעה נקבעת בנפרד על ידי כל מסעדה. מסעדות מסוימות עשויות
        לדרוש הודעה מראש לפני ביטול ועשויות לגבות דמי ביטול מאוחר או אי-הגעה.
        המדיניות החלה של המסעדה מוצגת לפני השלמת ההזמנה.
      </LegalP>
      <LegalP>
        <strong>הפקדות ודמי ביטול:</strong> תכונות אלה אינן פעילות כרגע בפלטפורמה. אם מסעדה
        תפעיל בעתיד פונקציונליות הפקדה או דמי ביטול, התנאים הרלוונטיים יוצגו לך בבירור
        לפני אישור ההזמנה, ונתוני התשלום שלך יעובדו על ידי ספק תשלומים מוסמך צד שלישי.
      </LegalP>

      <LegalSection id="waitlist" title="5. רשימת המתנה" />
      <LegalP>
        הצטרפות לרשימת המתנה אינה מבטיחה שולחן. אם שולחן יתפנה, המסעדה או הפלטפורמה
        ייצרו עמך קשר. הזמינות אינה שמורה עד לקבלת אישור מפורש.
      </LegalP>

      <LegalSection id="communications" title="6. תקשורת" />
      <LegalP>
        בביצוע הזמנה או הצטרפות לרשימת המתנה, אתה מסכים לקבל הודעות עסקיות בווטסאפ
        ו/או SMS הקשורות להזמנה שלך. הודעות אלה כוללות אישורים, תזכורות, הודעות איחור,
        הודעות ביטול ועדכוני רשימת המתנה. ניתן לבטל הסכמה על ידי פנייה אלינו בכתובת{' '}
        <LegalA href="mailto:info@iron-pos.com">info@iron-pos.com</LegalA>.
      </LegalP>

      <LegalSection id="liability" title="7. הגבלת אחריות" />
      <LegalP>
        Iron Booking פועלת אך ורק כמתווכת טכנולוגית בין אורחים למסעדות. איננו אחראים
        לאיכות חוויית הסועד, לזמינות שולחנות, לסגירת מסעדות או לכל פעולה או מחדל
        של המסעדה.
      </LegalP>
      <LegalP>
        במידה המרבית המותרת על פי חוק, פי סי איירון בע"מ לא תהיה אחראית לכל נזק
        עקיף, מקרי או תוצאתי הנובע מהשימוש בפלטפורמה.
      </LegalP>

      <LegalSection id="changes" title="8. שינויים בתנאים אלה" />
      <LegalP>
        אנו עשויים לעדכן תנאים אלה מעת לעת. תאריך "עודכן לאחרונה" בראש עמוד זה
        ישקף כל שינוי. המשך השימוש בפלטפורמה לאחר השינויים מהווה הסכמה לתנאים המעודכנים.
      </LegalP>

      <LegalSection id="governing-law" title="9. הדין החל" />
      <LegalP>
        תנאים אלה כפופים לחוקי מדינת ישראל. כל מחלוקת תהיה בסמכות השיפוט הבלעדית
        של בתי המשפט המוסמכים בחיפה, ישראל.
      </LegalP>

      <LegalSection id="contact" title="10. יצירת קשר" />
      <LegalP>
        פי סי איירון בע"מ · חיית 6, חיפה, ישראל ·{' '}
        <LegalA href="mailto:info@iron-pos.com">info@iron-pos.com</LegalA>
      </LegalP>

      <LegalDivider />
      <LegalP>
        <LegalA href="/privacy">מדיניות פרטיות</LegalA>
        {' · '}
        <LegalA href="/accessibility">נגישות</LegalA>
        {' · '}
        <LegalA href="/contact">צור קשר ותמיכה</LegalA>
      </LegalP>
    </>
  );
}
