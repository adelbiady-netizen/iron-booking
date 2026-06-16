export default function RootPage() {
  return (
    <div className="h-full bg-iron-bg flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-sm text-center">

        <div className="inline-flex items-center gap-2.5 mb-8">
          <div className="w-9 h-9 bg-iron-green rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm tracking-tight">IB</span>
          </div>
          <span className="text-iron-text font-semibold text-xl tracking-tight">Iron Booking</span>
        </div>

        <div className="bg-iron-card border border-iron-border rounded-xl p-8 mb-4">
          <p className="text-iron-text font-semibold text-base mb-2">
            קיבלתם קישור מסעדה מ-IRON Booking
          </p>
          <p className="text-iron-muted text-sm mb-6">
            הכניסה למערכת מתבצעת דרך הקישור הייחודי של המסעדה שלכם.
          </p>

          <div className="bg-iron-bg border border-iron-border rounded-lg px-4 py-3 mb-6 text-left" dir="ltr">
            <p className="text-iron-muted text-xs mb-1">דוגמה:</p>
            <p className="text-iron-green text-sm font-mono">ironbooking.com/your-restaurant</p>
          </div>

          <p className="text-iron-muted text-sm">
            לא מכירים את הקישור שלכם?<br />
            <span className="text-iron-text">פנו למנהל המסעדה לקבלת הקישור.</span>
          </p>
        </div>

        <p className="text-iron-muted text-xs">Iron Booking · מערכת ניהול הזמנות</p>

      </div>
    </div>
  );
}
