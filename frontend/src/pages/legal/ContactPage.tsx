import {
  LegalLayout, LegalH1, LegalSection, LegalP, LegalUl, LegalA, LegalDivider,
} from './LegalLayout';

export default function ContactPage() {
  return (
    <LegalLayout titleEn="Contact & Support" titleHe="צור קשר ותמיכה">
      {(isHebrew) => isHebrew ? <Hebrew /> : <English />}
    </LegalLayout>
  );
}

// ─── English ──────────────────────────────────────────────────────────────────

function English() {
  return (
    <>
      <LegalH1>Contact & Support</LegalH1>

      <LegalSection id="platform" title="Platform Support — Iron Booking" />
      <LegalP>
        For questions about the Iron Booking platform — technical issues, booking errors,
        accessibility, or privacy and legal matters — contact us directly:
      </LegalP>
      <LegalUl items={[
        <span key="email">
          Email:{' '}
          <LegalA href="mailto:info@iron-pos.com">info@iron-pos.com</LegalA>
        </span>,
        'Company: PC Iron Ltd.',
        'Address: Khayat 6, Haifa, Israel',
        'Service area: Israel',
      ]} />
      <LegalP>
        We aim to respond to all support requests within 2 business days.
      </LegalP>

      <LegalSection id="restaurant" title="Restaurant-Specific Issues" />
      <LegalP>
        Iron Booking is a technology platform. The following matters are the direct responsibility
        of the restaurant you booked with:
      </LegalP>
      <LegalUl items={[
        'Table availability on the day',
        'Waitlist queue status and timing',
        'Menu, pricing, and dietary requests',
        'Cancellation and no-show fees (if applicable)',
        'On-site dining experience',
      ]} />
      <LegalP>
        For these matters, please contact the restaurant directly using the phone number or
        website shown in your reservation confirmation.
      </LegalP>

      <LegalSection id="types" title="What We Can Help With" />
      <LegalUl items={[
        'Reservation confirmation not received',
        'Error or bug when submitting a booking',
        'WhatsApp / SMS message not received',
        'Request to delete your personal data',
        'Accessibility issues on the booking page',
        'General enquiries about Iron Booking',
      ]} />

      <LegalSection id="booking-issues" title="Didn\'t Receive Your Confirmation?" />
      <LegalP>
        If you submitted a reservation but did not receive a WhatsApp or SMS confirmation,
        please check that the phone number you entered is correct. If the issue persists,
        email us at{' '}
        <LegalA href="mailto:info@iron-pos.com">info@iron-pos.com</LegalA>{' '}
        with your name, the restaurant name, and the date and time of your reservation.
      </LegalP>

      <LegalDivider />
      <LegalP>
        <LegalA href="/privacy">Privacy Policy</LegalA>
        {' · '}
        <LegalA href="/terms">Terms of Service</LegalA>
        {' · '}
        <LegalA href="/accessibility">Accessibility Statement</LegalA>
      </LegalP>
    </>
  );
}

// ─── Hebrew ───────────────────────────────────────────────────────────────────

function Hebrew() {
  return (
    <>
      <LegalH1>צור קשר ותמיכה</LegalH1>

      <LegalSection id="platform" title="תמיכה בפלטפורמה — Iron Booking" />
      <LegalP>
        לשאלות בנוגע לפלטפורמת Iron Booking — בעיות טכניות, שגיאות בהזמנה, נגישות
        או עניינים משפטיים ופרטיות — פנה אלינו ישירות:
      </LegalP>
      <LegalUl items={[
        <span key="email">
          דוא"ל:{' '}
          <LegalA href="mailto:info@iron-pos.com">info@iron-pos.com</LegalA>
        </span>,
        'חברה: פי סי איירון בע"מ',
        'כתובת: חיית 6, חיפה, ישראל',
        'אזור שירות: ישראל',
      ]} />
      <LegalP>
        אנו שואפים להגיב לכל פניות התמיכה תוך 2 ימי עסקים.
      </LegalP>

      <LegalSection id="restaurant" title="בעיות הקשורות למסעדה ספציפית" />
      <LegalP>
        Iron Booking היא פלטפורמה טכנולוגית. הנושאים הבאים הם באחריות הישירה של המסעדה
        שאצלה הזמנת:
      </LegalP>
      <LegalUl items={[
        'זמינות שולחנות ביום',
        'מצב ותזמון תור רשימת ההמתנה',
        'תפריט, תמחור ובקשות תזונתיות',
        'דמי ביטול ואי-הגעה (אם חלים)',
        'חוויית הסועד במקום',
      ]} />
      <LegalP>
        לנושאים אלה, אנא פנה למסעדה ישירות באמצעות מספר הטלפון או האתר המצוין
        באישור ההזמנה שלך.
      </LegalP>

      <LegalSection id="types" title="במה אנחנו יכולים לעזור" />
      <LegalUl items={[
        'אישור הזמנה לא התקבל',
        'שגיאה או באג בעת הגשת הזמנה',
        'הודעת ווטסאפ / SMS לא התקבלה',
        'בקשה למחיקת המידע האישי שלך',
        'בעיות נגישות בדף ההזמנה',
        'פניות כלליות בנוגע ל-Iron Booking',
      ]} />

      <LegalSection id="booking-issues" title="לא קיבלת את האישור?" />
      <LegalP>
        אם הגשת הזמנה אך לא קיבלת אישור בווטסאפ או SMS, אנא בדוק שמספר הטלפון
        שהזנת נכון. אם הבעיה נמשכת, שלח לנו דוא"ל לכתובת{' '}
        <LegalA href="mailto:info@iron-pos.com">info@iron-pos.com</LegalA>{' '}
        עם שמך, שם המסעדה, ותאריך ושעת ההזמנה.
      </LegalP>

      <LegalDivider />
      <LegalP>
        <LegalA href="/privacy">מדיניות פרטיות</LegalA>
        {' · '}
        <LegalA href="/terms">תנאי שירות</LegalA>
        {' · '}
        <LegalA href="/accessibility">נגישות</LegalA>
      </LegalP>
    </>
  );
}
