import { useEffect, useState } from 'react';
import { api } from '../api';

type Sentiment = 'EXCELLENT' | 'GOOD' | 'BAD';

const TAGS = [
  'שירות',
  'אוכל',
  'ניקיון',
  'זמן המתנה',
  'מיקום ישיבה',
  'אווירה',
];

const SENTIMENT_OPTIONS: { value: Sentiment; emoji: string; label: string; color: string; selectedColor: string }[] = [
  { value: 'EXCELLENT', emoji: '😍', label: 'מצוין', color: 'border-gray-200 hover:border-green-400', selectedColor: 'border-green-500 bg-green-50' },
  { value: 'GOOD',      emoji: '🙂', label: 'טוב',   color: 'border-gray-200 hover:border-blue-400',  selectedColor: 'border-blue-500 bg-blue-50'  },
  { value: 'BAD',       emoji: '😕', label: 'לא טוב', color: 'border-gray-200 hover:border-red-400',   selectedColor: 'border-red-500 bg-red-50'    },
];

export default function FeedbackPage({ token }: { token: string }) {

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restaurantName, setRestaurantName] = useState('');
  const [guestName, setGuestName] = useState<string | null>(null);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [done, setDone] = useState(false);

  const [sentiment, setSentiment] = useState<Sentiment | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [freeText, setFreeText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;
    api.feedback.get(token)
      .then(data => {
        setRestaurantName(data.restaurant.name);
        setGuestName(data.guestName);
        setAlreadySubmitted(data.alreadySubmitted);
        setLoading(false);
      })
      .catch(() => {
        setError('הקישור אינו תקין או שפג תוקפו.');
        setLoading(false);
      });
  }, [token]);

  function toggleTag(tag: string) {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  }

  async function handleSubmit() {
    if (!sentiment || !token) return;
    setSubmitting(true);
    try {
      await api.feedback.submit(token, {
        sentiment,
        freeText: freeText.trim() || undefined,
        tags: selectedTags.length > 0 ? selectedTags : undefined,
      });
      setDone(true);
    } catch {
      setError('אירעה שגיאה. נסה שוב.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-4 border-gray-300 border-t-gray-700 rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6" dir="rtl">
        <div className="text-center">
          <p className="text-2xl mb-3">🔗</p>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (alreadySubmitted || done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6" dir="rtl">
        <div className="text-center max-w-sm">
          <p className="text-5xl mb-4">{done && sentiment === 'EXCELLENT' ? '🎉' : '✅'}</p>
          <h1 className="text-2xl font-bold text-gray-800 mb-2">תודה!</h1>
          <p className="text-gray-500">
            {alreadySubmitted
              ? 'כבר שלחת משוב עבור ביקור זה.'
              : 'המשוב שלך נקלט ויעזור לנו להשתפר.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6" dir="rtl">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-800">{restaurantName}</h1>
          {guestName && (
            <p className="text-gray-500 mt-1">שלום {guestName.split(' ')[0]}, נשמח לשמוע מה חשבת</p>
          )}
          {!guestName && (
            <p className="text-gray-500 mt-1">נשמח לשמוע מה חשבת על הביקור שלך</p>
          )}
        </div>

        {/* Sentiment buttons */}
        <div className="flex gap-3 justify-center mb-8">
          {SENTIMENT_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setSentiment(opt.value)}
              className={`flex-1 flex flex-col items-center gap-2 py-4 px-2 rounded-xl border-2 transition-all ${
                sentiment === opt.value ? opt.selectedColor : opt.color + ' bg-white'
              }`}
            >
              <span className="text-3xl">{opt.emoji}</span>
              <span className="text-sm font-medium text-gray-700">{opt.label}</span>
            </button>
          ))}
        </div>

        {sentiment && (
          <>
            {/* Tags */}
            <div className="mb-6">
              <p className="text-sm font-medium text-gray-600 mb-3">על מה רצית לדבר? (אופציונלי)</p>
              <div className="flex flex-wrap gap-2">
                {TAGS.map(tag => (
                  <button
                    key={tag}
                    onClick={() => toggleTag(tag)}
                    className={`px-3 py-1.5 rounded-full text-sm border transition-all ${
                      selectedTags.includes(tag)
                        ? 'bg-gray-800 text-white border-gray-800'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            {/* Free text */}
            <div className="mb-8">
              <p className="text-sm font-medium text-gray-600 mb-2">משהו שכדאי שנדע? (אופציונלי)</p>
              <textarea
                value={freeText}
                onChange={e => setFreeText(e.target.value)}
                placeholder="כתוב כאן..."
                maxLength={1000}
                rows={3}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-800 placeholder-gray-400 focus:outline-none focus:border-gray-400 resize-none text-sm"
              />
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full py-3.5 rounded-xl bg-gray-800 text-white font-semibold text-base hover:bg-gray-700 disabled:opacity-50 transition-colors"
            >
              {submitting ? 'שולח...' : 'שלח משוב'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
