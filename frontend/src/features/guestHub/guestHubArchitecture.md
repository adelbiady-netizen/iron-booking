# Guest Hub — Architecture Foundation

**Iron Booking | Internal Strategic Document**
Version 1.0 — Phase 2

---

## Overview

The Guest Hub is Iron Booking's guest-facing digital presence layer. It transforms a reservation platform into a full hospitality brand experience — accessible via QR code, direct link, or discovery search.

The design philosophy is deliberately different from generic QR menu builders:

- **Hospitality-first**, not tech-first. Every data model starts from how real restaurants operate, not from what is easy to build.
- **Operator-controlled, guest-experienced.** Operators configure; guests consume. No self-serve guest accounts in the core flow.
- **Operationally isolated.** A Guest Hub outage must never affect reservations, floor management, or SSE streams.
- **Scalable by default.** Single restaurant today, multi-group multi-country tomorrow. The schema must not require a rewrite to scale.

---

## 1. Core Platform Entities

### 1.1 HospitalityGroup

The top-level owner entity for restaurant groups (e.g., a hospitality company that operates multiple restaurant concepts across cities or countries).

```
HospitalityGroup
├── id                UUID, primary key
├── name              string          "Soho House F&B"
├── slug              string, unique  "soho-house"
├── tier              enum            STANDARD | PREMIUM | ENTERPRISE
├── defaultLocale     string          "en"
├── logoUrl           string?
├── brandingPresetId  UUID?           group-level default branding
├── isActive          boolean
├── createdAt         timestamp
└── updatedAt         timestamp
```

A `HospitalityGroup` is optional. A standalone restaurant has no `groupId`. Groups allow:
- Shared branding presets applied to all member restaurants
- Group-level discovery pages (`/g/soho-house`)
- Consolidated analytics across all branches
- Single contract billing

---

### 1.2 Restaurant

A restaurant concept or brand (e.g., "Nobu", "Zuma"). A restaurant is abstract — it may have one location or fifty.

```
Restaurant
├── id                UUID, primary key
├── groupId           UUID?           FK → HospitalityGroup (null for independent)
├── name              string          "Ember & Stone"
├── slug              string, unique  "ember-and-stone"
├── cuisineType       string[]        ["Contemporary", "European"]
├── priceRange        enum            BUDGET | MODERATE | UPSCALE | FINE_DINING
├── defaultLocale     string          "en"
├── isActive          boolean
├── createdAt         timestamp
└── updatedAt         timestamp
```

A single-branch restaurant resolves `/r/ember-and-stone` directly to its one branch's GuestHub. A multi-branch restaurant shows a branch picker first.

---

### 1.3 Branch

A physical operating location. This is where most operational data lives.

```
Branch
├── id                UUID, primary key
├── restaurantId      UUID            FK → Restaurant
├── name              string          "Ember & Stone — Midtown"
├── slug              string          "midtown"  (unique within restaurant)
├── address           Address         (structured, see below)
├── coordinates       LatLng          for map/directions
├── timezone          string          "America/New_York"
├── phone             string?
├── email             string?
├── isActive          boolean
├── openingHours      WeeklyHours[]   structured opening hours per day
├── defaultLocale     string          inherits from Restaurant if null
├── acceptsReservations  boolean
├── acceptsWalkIn        boolean
├── createdAt         timestamp
└── updatedAt         timestamp

Address {
  line1, line2?, city, stateOrProvince?, postalCode, country (ISO 3166-1)
}

WeeklyHours {
  dayOfWeek: 0–6,
  isOpen: boolean,
  periods: { open: "HH:MM", close: "HH:MM" }[]
}
```

Each branch has its own `GuestHub`, `Menu`, `Promotions`, `Events`, and `SocialLinks`. Branch-level data always takes precedence over restaurant-level defaults.

---

### 1.4 GuestHub

The configuration record that controls what a guest sees and what they can do. One hub per branch.

```
GuestHub
├── id                UUID, primary key
├── branchId          UUID, unique    FK → Branch (one-to-one)
├── isPublished       boolean         false = draft, true = publicly accessible
├── publishedAt       timestamp?
├── brandingId        UUID            FK → Branding
├── tagline           LocalisedText   short brand statement
├── customDomain      string?         "menu.emberandstone.com"
├── qrTracking        boolean         enable per-scan analytics
├── settings          HubSettings     (see below)
├── createdAt         timestamp
└── updatedAt         timestamp

HubSettings {
  showFeaturedDishes:    boolean
  showMenuCategories:    boolean
  showPromotions:        boolean
  showEvents:            boolean
  showHours:             boolean
  showSocialLinks:       boolean
  featuredDishIds:       UUID[]    ordered list of manually curated dishes
  announcementText:      LocalisedText?   e.g. "Closed for private event tonight"
  announcementVisible:   boolean
}
```

`isPublished = false` means the hub URL resolves to a 404 (or a coming-soon page) for guests, while the operator can preview it in the dashboard.

---

### 1.5 Branding

The visual identity configuration for a hub. Branding is resolved in this precedence order:
`Branch-level Branding → Restaurant-level default → Group-level default → Iron Booking system default`

```
Branding
├── id                UUID, primary key
├── ownerType         enum            BRANCH | RESTAURANT | GROUP
├── ownerId           UUID            polymorphic FK
├── preset            enum            NOIR | IVORY | SLATE | COPPER | SAGE | custom
├── accentColor       string?         hex, validated within preset's allowed range
├── logoUrl           string?         uploaded, CDN-served
├── heroImageUrl      string?         16:9 or 4:3, CDN-served
├── heroImageFocalPoint  FocalPoint?  { x: 0.5, y: 0.3 } — for smart cropping
├── fontPreset        enum            MODERN | SERIF | GEOMETRIC | EDITORIAL
├── borderRadiusScale enum            SHARP | SOFT | ROUND
├── createdAt         timestamp
└── updatedAt         timestamp

FocalPoint { x: float 0–1, y: float 0–1 }
```

See Section 6 for the branding philosophy and preset system design.

---

### 1.6 Menu

A branch can have multiple menus (lunch, dinner, Sunday brunch). Only one menu is the "active" hub menu at a time, or menus are shown by time-of-day rules.

```
Menu
├── id                UUID, primary key
├── branchId          UUID            FK → Branch
├── name              LocalisedText   "Dinner Menu", "תפריט ערב"
├── isActive          boolean
├── displayOrder      integer
├── availabilityRules MenuAvailability?
├── seasonalFrom      date?
├── seasonalTo        date?
├── createdAt         timestamp
└── updatedAt         timestamp

MenuAvailability {
  daysOfWeek:   int[]         [5, 6] = Fri, Sat
  timeFrom:     "HH:MM"
  timeTo:       "HH:MM"
}
```

---

### 1.7 MenuCategory

Sections within a menu (Starters, Mains, etc.).

```
MenuCategory
├── id                UUID, primary key
├── menuId            UUID            FK → Menu
├── name              LocalisedText
├── description       LocalisedText?
├── coverImageUrl     string?
├── displayOrder      integer
├── isVisible         boolean
├── createdAt         timestamp
└── updatedAt         timestamp
```

---

### 1.8 Dish

An individual menu item.

```
Dish
├── id                UUID, primary key
├── categoryId        UUID            FK → MenuCategory
├── name              LocalisedText
├── description       LocalisedText?
├── price             Money           { amount: decimal, currency: ISO 4217 }
├── priceVariants     PriceVariant[]  [{ label: "Half", price: {...} }]
├── imageUrl          string?
├── imageBlurhash     string?         LQIP for instant placeholder
├── allergens         string[]        ["gluten", "nuts", "dairy"]
├── dietaryFlags      string[]        ["vegetarian", "vegan", "halal", "kosher"]
├── isAvailable       boolean         can be toggled live (86'd items)
├── isFeatured        boolean         shown in hub's featured section
├── displayOrder      integer
├── tags              string[]        ["Chef's pick", "Seasonal", "New"]
├── createdAt         timestamp
└── updatedAt         timestamp

Money { amount: decimal(10,2), currency: string }
PriceVariant { label: LocalisedText, price: Money }
```

`isAvailable` is the only field that needs near-real-time sync in a POS integration scenario. All other dish fields are editorial and change infrequently.

---

### 1.9 Promotion

Time-bounded content cards — seasonal menus, special offers, featured experiences.

```
Promotion
├── id                UUID, primary key
├── branchId          UUID            FK → Branch
├── title             LocalisedText
├── body              LocalisedText
├── imageUrl          string?
├── type              enum            OFFER | FEATURE | ANNOUNCEMENT | SEASONAL
├── priority          integer         display order
├── validFrom         timestamp?
├── validTo           timestamp?
├── ctaType           enum?           RESERVE | CALL | URL | NONE
├── ctaLabel          LocalisedText?
├── ctaTarget         string?         URL or tel: for ctaType=URL/CALL
├── isActive          boolean
├── createdAt         timestamp
└── updatedAt         timestamp
```

Promotions are filtered client-side by `validFrom / validTo` using the branch's timezone. Expired promotions are hidden without deletion — the history is preserved for analytics.

---

### 1.10 Event

Scheduled occurrences: chef's tables, wine tastings, live music, seasonal dinners.

```
Event
├── id                UUID, primary key
├── branchId          UUID            FK → Branch
├── title             LocalisedText
├── description       LocalisedText?
├── imageUrl          string?
├── tag               string?         "Exclusive", "Members only"
├── startAt           timestamp       branch-timezone-aware
├── endAt             timestamp?
├── isRecurring       boolean
├── recurrenceRule    string?         iCal RRULE — e.g. "FREQ=WEEKLY;BYDAY=FR"
├── maxCapacity       integer?
├── price             Money?          ticketed events
├── bookingUrl        string?         external ticketing (Eventbrite, Tock, etc.)
├── isPublished       boolean
├── createdAt         timestamp
└── updatedAt         timestamp
```

Recurring events (e.g. Friday Chef's Table) use the iCal RRULE standard. The guest-facing API expands the next N occurrences on read, avoiding materialising thousands of event rows.

---

### 1.11 SocialLinks

```
SocialLink
├── id                UUID, primary key
├── branchId          UUID            FK → Branch
├── platform          enum            INSTAGRAM | TIKTOK | FACEBOOK | X | WEBSITE
│                                     | TRIPADVISOR | GOOGLE | OPENTABLE | RESY
├── handle            string?         "@emberandstone"
├── url               string          validated full URL
├── displayOrder      integer
├── isVisible         boolean
├── createdAt         timestamp
└── updatedAt         timestamp
```

Platforms like TripAdvisor, Google, and OpenTable are included because review/booking platform links are as operationally important as social channels for a hospitality brand.

---

### 1.12 GuestActions

The configurable set of actions a guest can take from the hub. The operator chooses which actions are enabled, in what order, and with what label.

```
GuestAction
├── id                UUID, primary key
├── hubId             UUID            FK → GuestHub
├── type              enum            RESERVE | WAITLIST | CALL | DIRECTIONS
│                                     | ORDER | LOYALTY | GIFT_CARD | NEWSLETTER
├── isEnabled         boolean
├── label             LocalisedText?  override default label e.g. "Book a table"
├── target            string?         URL, tel:, or internal route identifier
├── displayOrder      integer
├── style             enum            PRIMARY | SECONDARY | GHOST
└── createdAt         timestamp
```

This entity allows the hub to evolve from a read-only showcase into an action platform — ordering, gift cards, loyalty check-in — without schema changes.

---

## 2. Entity Relationships

```
HospitalityGroup (1)
    └──< Restaurant (many)
              └──< Branch (many)
                      ├── GuestHub (1:1)
                      │       ├── Branding (FK)
                      │       └──< GuestAction (many)
                      ├──< Menu (many)
                      │       └──< MenuCategory (many)
                      │               └──< Dish (many)
                      ├──< Promotion (many)
                      ├──< Event (many)
                      └──< SocialLink (many)

Branding
    ├── owned by Branch  (ownerType=BRANCH)
    ├── owned by Restaurant (ownerType=RESTAURANT, inherited by branches)
    └── owned by Group  (ownerType=GROUP, inherited by restaurants)
```

**Inheritance rules:**
- A Branch's GuestHub uses the Branch Branding if it exists.
- If not, it falls back to Restaurant Branding.
- If not, it falls back to Group Branding.
- If not, it uses the Iron Booking system default.
- This allows a restaurant group to set a global brand standard while individual branches can override specific elements (e.g., a beach location with a lighter preset than the city flagship).

---

## 3. Recommended Database Structure

### Table topology (high-level, database-agnostic)

```
── Identity & ownership ──────────────────────────────────────────
hospitality_groups
restaurants               (fk: group_id nullable)
branches                  (fk: restaurant_id)

── Hub configuration ─────────────────────────────────────────────
guest_hubs                (fk: branch_id, unique — 1:1 with branch)
brandings                 (polymorphic: owner_type + owner_id)
guest_actions             (fk: hub_id)

── Menu content ──────────────────────────────────────────────────
menus                     (fk: branch_id)
menu_categories           (fk: menu_id)
dishes                    (fk: category_id)

── Editorial content ─────────────────────────────────────────────
promotions                (fk: branch_id)
events                    (fk: branch_id)
social_links              (fk: branch_id)

── Internationalisation ──────────────────────────────────────────
translations              (polymorphic: entity_type, entity_id, locale, field, value)

── Analytics (append-only, separate schema or service) ───────────
hub_page_views            (hub_id, sessionId, timestamp, device, locale)
hub_cta_events            (hub_id, action_type, timestamp, sessionId)
qr_scan_events            (qr_token_id, timestamp, ip_hash, device)
dish_view_events          (dish_id, hub_id, timestamp, sessionId)

── QR codes ──────────────────────────────────────────────────────
qr_codes                  (id, branch_id, token, location_hint, created_at)
```

### Key design decisions

**Polymorphic translations table vs. per-entity translation tables**

A single `translations` table (`entity_type, entity_id, locale, field, value`) is more flexible and avoids 15+ migration files when adding a new translatable entity. The downside is no foreign key enforcement per entity — acceptable at this stage, enforced at the application layer.

**Analytics in a separate schema**

Analytics tables are append-only and high-volume. They must not share transactions with editorial data. They should be in a separate schema (or eventually a separate database/warehouse). Analytics failures must never block a hub page from rendering.

**Soft deletes on all editorial entities**

All content tables include a `deletedAt timestamp?` column. Deletion is never hard delete — this protects analytics history and gives operators an undo window.

**Currency stored with amount**

Every `Money` value stores both `amount` and `currency` (ISO 4217 code). Never store a bare decimal assuming a currency. This is the foundational requirement for multi-country support.

---

## 4. Slug Architecture

### URL patterns

```
Pattern                                   Resolves to
──────────────────────────────────────────────────────────────────────
/r/:restaurantSlug                        → Branch hub (if 1 branch)
                                          → Branch picker (if multiple)

/r/:restaurantSlug/:branchSlug            → Branch hub directly

/g/:groupSlug                             → Group discovery page (Phase 9)
/g/:groupSlug/:restaurantSlug             → Restaurant within group
/g/:groupSlug/:restaurantSlug/:branchSlug → Branch within group restaurant

/q/:qrToken                               → Resolves to branch hub + logs scan
/hub/:customSubdomain                     → Custom domain support (Phase 6+)
```

### Slug rules

**Restaurant slug:**
- Globally unique across the platform
- URL-safe: lowercase, hyphens, no special characters
- 3–60 characters
- Immutable after first publication (changing it breaks QR codes and bookmarks)
- If a restaurant name is ambiguous, append city: `nobu-london`, `nobu-new-york`
- Collision resolution: system appends `-2`, `-3` etc. at creation time

**Branch slug:**
- Unique within the parent restaurant (not globally)
- Typically the location name: `soho`, `midtown`, `tel-aviv`
- Also immutable after publication

**QR token:**
- 12-character URL-safe random string (`/q/x7K2mPqRn4Lj`)
- Resolves to the branch hub via lookup, not encoding
- Tokens are never reused, never deleted — only deactivated
- Each QR print run gets a new token for tracking purposes

### Single-branch shortcut

A restaurant with exactly one active branch should redirect `/r/ember-and-stone` directly to that branch's hub. No intermediate page. When a second branch is created, the system adds a branch-picker landing page automatically and the existing QR codes (which point to `/q/:token`) remain unaffected.

### Custom domains (Phase 6+)

`menu.emberandstone.com` → resolves to `/r/ember-and-stone/midtown`

Implemented via a DNS CNAME to Iron Booking's edge, with an SSL certificate provisioned automatically. The `customDomain` field on `GuestHub` stores the operator's domain. A reverse-lookup table maps incoming hostnames to hub IDs.

---

## 5. Multi-Language Strategy

### Content internationalisation

All guest-visible text fields that contain operator-authored content are stored as `LocalisedText`:

```typescript
// Application-layer type — not a database column type
type LocalisedText = {
  [locale: string]: string;   // { "en": "Wagyu Tartare", "he": "טרטר וואגיו" }
  default: string;            // fallback if requested locale not available
}
```

In the database, this is stored in the polymorphic `translations` table. The application layer merges translations on read, returning the best available match for the requested locale.

**Resolution order for a requested locale (`he`):**
1. Hebrew translation exists → use it
2. Hebrew translation missing → use restaurant's `defaultLocale`
3. Restaurant default missing → use English
4. English missing → use any available translation

### UI labels vs. content

A strict distinction is maintained:

| Type | Examples | Managed by |
|---|---|---|
| **UI labels** | "Reserve a table", "Explore by category" | Iron Booking i18n system (strings.ts / strings-he.ts) |
| **Content** | Dish names, descriptions, promotions | Operator-authored, stored in DB translations |
| **Hybrid** | Day names in hours table, price formatting | Iron Booking i18n system using Intl APIs |

UI labels use the existing `useT()` hook and `strings.ts` / `strings-he.ts` infrastructure already in the project. The Guest Hub will have its own `guestHub` namespace in those files:

```typescript
// strings.ts additions (Phase 3)
guestHub: {
  ctaReserve:       'Reserve a table',
  ctaWaitlist:      'Waitlist',
  ctaCall:          'Call us',
  ctaDirections:    'Get directions',
  sectionDishes:    'Signature dishes',
  sectionMenu:      'Explore by category',
  sectionEvents:    'Events & specials',
  sectionHours:     'Hours',
  sectionConnect:   'Connect',
  poweredBy:        'Powered by Iron Booking',
  demoNotice:       'Connect a restaurant to activate this action',
  // ...
}
```

### RTL/LTR support

Layout direction is set at the page root based on the resolved locale:

```typescript
const RTL_LOCALES = ['he', 'ar', 'fa', 'ur'];
const isRTL = RTL_LOCALES.includes(resolvedLocale);
```

The GuestHub page root receives `dir="rtl"` or `dir="ltr"`. CSS uses logical properties for spacing (`padding-inline-start`, `margin-block-end`) rather than physical properties (`padding-left`, `margin-bottom`) wherever direction matters. Icon mirroring (chevrons, directional arrows) is handled via `[dir="rtl"] .gh-chevron { transform: scaleX(-1) }`.

The current Phase 1 component uses physical properties throughout — this is acceptable as a placeholder. Phase 7 (multi-language) will audit and migrate all directional styles to logical properties.

### Language detection (Phase 3+)

```
1. URL parameter: ?lang=he (explicit, operator-set link)
2. Cookie: iron_gh_locale (previously resolved locale)
3. Accept-Language header (browser preference)
4. Restaurant defaultLocale
5. Fallback: "en"
```

Language switcher UI appears on the hub only if the restaurant has configured at least 2 locales for their content. No switcher if content is only in one language.

---

## 6. Branding System Philosophy

### The core problem with free-form customisation

Most QR menu builders offer unlimited colour pickers, font uploads, and layout controls. This produces two failure modes:
1. Operators design inconsistent, visually poor pages that reflect badly on their brand.
2. The platform loses its ability to guarantee quality — Iron Booking's brand association degrades with every bad-looking hub.

The solution is not restriction — it is **guided expression within a curated system**.

### Preset architecture

Iron Booking ships a library of curated branding presets, each designed for a specific hospitality category:

| Preset | Feeling | Background | Accent | Font class | Best for |
|---|---|---|---|---|---|
| `NOIR` | Luxury, intimate | Near-black warm | Warm gold | Modern | Fine dining, steakhouses |
| `IVORY` | Clean, light | Off-white warm | Deep bronze | Serif | French bistros, patisseries |
| `SLATE` | Urban, minimal | Cool dark grey | Electric blue | Geometric | Contemporary bars, fusion |
| `COPPER` | Warm, artisanal | Dark brown | Terracotta | Editorial | Farm-to-table, gastropubs |
| `SAGE` | Natural, fresh | Dark olive | Sage green | Modern | Vegetarian, wellness cafés |
| `MIDNIGHT` | Deep blue, premium | Near-black cool | Silver | Serif | Omakase, private dining |

Each preset is a complete design system: background tones, surface tones, border colours, text hierarchy colours, and accent colour. It is not a single colour — it is 12 coordinated values.

### Safe customisation within presets

Within a chosen preset, operators can override:
- **Logo** — uploaded image, rendered within a constrained container with automatic dark/light adaptation
- **Hero image** — with a focal point selector for smart cropping across device sizes
- **Accent colour** — restricted to a hue range defined by the preset (e.g. NOIR allows accent changes from warm gold to rose gold; it does not allow a neon green override)
- **Tagline text** — content, not styling

Operators cannot change:
- Typography (font family, size scale, weight hierarchy)
- Spacing (the Iron Booking hospitality grid)
- Border radius scale (preset-defined: SHARP / SOFT / ROUND)
- Layout structure

### Design consistency enforcement

The `Branding` entity stores only the operator's choices (`preset`, `accentColor`, `logoUrl`, `heroImageUrl`). The full computed design token set is derived at render time from those inputs plus the preset definition. The preset definitions live in code, not in the database — this means a preset improvement (e.g., better font sizing) deploys to all restaurants using that preset simultaneously, without any migration.

---

## 7. Image Strategy

### Image types and specifications

| Context | Aspect ratio | Recommended dimensions | Max file size | Format |
|---|---|---|---|---|
| Hero (full-bleed) | 16:9 or 3:2 | 1920×1080 | 5MB | JPEG/WebP |
| Dish card | 4:3 or 1:1 | 800×600 | 2MB | JPEG/WebP |
| Category cover | 3:2 | 600×400 | 1MB | JPEG/WebP |
| Logo | Any (transparent preferred) | 400×400 | 500KB | PNG/WebP |
| Promotion | 16:9 | 1200×675 | 2MB | JPEG/WebP |

### Processing pipeline (Phase 4+)

On upload, every image is processed:
1. **Validation** — dimensions, file size, MIME type
2. **Transcoding** — converted to WebP at multiple breakpoints (480w, 800w, 1200w, 1920w)
3. **Optimisation** — quality compression tuned per image type
4. **Blurhash generation** — a 4×3 component blurhash string is computed and stored on the dish/branding record. This enables a blurred colour-accurate placeholder while the real image loads, preventing layout shift and maintaining premium feel
5. **CDN upload** — stored on Vercel Blob or Cloudflare Images; the `imageUrl` field stores the CDN base URL
6. **Focal point** — stored as `{ x: float, y: float }` for hero images; used to generate CSS `object-position` values for correct cropping across aspect ratios

### Rendering strategy

```typescript
// Dish image — aspect-ratio container prevents layout shift
<div style={{ aspectRatio: '4/3', borderRadius: 12, overflow: 'hidden', background: blurhashToCSSGradient(dish.imageBlurhash) }}>
  <img
    src={dish.imageUrl}
    srcSet={`${dish.imageUrl}?w=400 400w, ${dish.imageUrl}?w=800 800w`}
    sizes="(max-width: 480px) 168px, 200px"
    loading="lazy"
    decoding="async"
    alt={dish.name}
    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
  />
</div>
```

Key requirements:
- **`loading="lazy"`** on all below-fold images
- **`decoding="async"`** to prevent blocking the main thread during image decode
- **`srcSet` and `sizes`** on all images — never serve a 1920px image to a 375px phone
- **Blurhash placeholder** shown until the real image fires `onLoad` — avoids the grey-box flash
- **`alt` text** derived from the dish name — always present, always meaningful
- **No layout shift** — the aspect-ratio container always reserves space before the image loads

### Graceful degradation

If an image fails to load, the gradient placeholder from Phase 1 is the fallback. The gradient is always rendered behind the `<img>` tag. No broken image icon ever appears.

---

## 8. Future Scalability Considerations

### 8.1 Multi-branch groups

When a HospitalityGroup has many restaurants and branches:

- **Group discovery page** (`/g/:groupSlug`): shows all restaurants with their branch locations on a map, filterable by cuisine and city
- **Inherited branding**: group sets default preset; restaurants and branches can override specific elements
- **Consolidated operator dashboard**: a group manager can see all branches' hub publish status, analytics aggregates, and pending content from a single view
- **Shared menu templates**: a group can define a master menu that branches inherit and locally customise (e.g., same cocktail menu across all locations, different food menus)

### 8.2 Marketplace and discovery

The Guest Hub public pages are SEO-indexable — this is a deliberate product decision. Over time, Iron Booking becomes a restaurant discovery layer:

- Server-side rendered (or statically generated) hub pages for crawlability
- Structured data (`schema.org/Restaurant`, `schema.org/Menu`) embedded in page head
- Public search index: `/discover?city=tel-aviv&cuisine=italian&priceRange=UPSCALE`
- Iron Booking appears in Google's restaurant knowledge panel through the structured data

This is not a marketing afterthought — it is baked into the URL and rendering architecture from Phase 1.

### 8.3 Loyalty

Guest profiles are created opt-in at the point of reservation or waitlist entry. Loyalty is earned through visits, not sign-ups:

- Visit history: linked by email + phone hash across reservations
- Preferences: dietary restrictions, seating preferences, occasion history
- Tier system (operator-configured): Guest → Regular → VIP → Member
- Recognition triggers: birthday month, anniversary, first visit after long absence
- The loyalty data model is branch-level — a guest is loyal to a branch, not to a group (though group-level aggregation is possible in Phase 9+)

No loyalty points or monetary value in Phase 1 through Phase 7. The foundation is accurate visit tracking, which is already partially available from the existing reservation data.

### 8.4 Analytics

Analytics are event-sourced and append-only. They feed a separate read model:

```
Events captured:
  HUB_VIEW          — guest opens the hub URL
  SECTION_VISIBLE   — a section scrolls into viewport (IntersectionObserver)
  CTA_TAP           — guest taps a GuestAction button
  DISH_VIEW         — guest opens a dish detail (Phase 5+)
  QR_SCAN           — guest arrives via a QR token URL
  RESERVATION_START — guest leaves hub for the booking flow
  RESERVATION_COMPLETE — reservation confirmed (cross-system join)

Metrics derived:
  Hub views per day/week/month
  CTA conversion rate: views → reserve taps → completed reservations
  Most-viewed dishes (Phase 5+)
  QR scan volume by location hint (table vs. entrance vs. takeaway)
  Section engagement: what percentage of visitors reach events? hours? social?
  Device breakdown: mobile vs. tablet vs. desktop
  Locale breakdown: what languages are guests using?
```

Analytics data must never block rendering. All tracking calls are `fire-and-forget` — a failed analytics write does not error the hub page.

### 8.5 QR tracking

Each QR code printed by a restaurant is a unique tracked token:

```
QR Code lifecycle:
  1. Operator generates QR code in the Iron Booking dashboard
  2. System mints a token: /q/x7K2mPqRn4Lj
  3. Operator specifies location hint: "Table 12", "Entrance", "Delivery bag"
  4. QR code is printed/displayed
  5. Guest scans → /q/x7K2mPqRn4Lj resolves to branch hub
  6. Scan event logged: token_id, timestamp, device, ip_hash (anonymised)
  7. Guest sees hub; analytics knows which physical location triggered the visit
```

This allows operators to measure: which tables scan most, what time of day scans peak, whether delivery/takeaway bag QRs drive reorders. These are uniquely hospitality insights that generic QR builders do not capture.

### 8.6 POS integrations

POS integration is Phase 10+ and requires individual partnership agreements, but the data model supports it from Phase 2:

- `Dish.isAvailable` is the real-time toggle — POS webhooks write to this field
- `Dish` has a `posItemId` field (not in Phase 2 schema above, added at integration time) for ID mapping
- Menu sync is push-based: POS sends item updates; Iron Booking receives them via a webhook endpoint
- Price sync follows the same path
- The 86'd item flow (marking a dish unavailable mid-service) requires near-real-time propagation — the hub must re-fetch or use SSE to receive availability updates

---

## 9. Operational Isolation Rules

The Guest Hub is a **read-only public system** from the perspective of Iron Booking's core operational data. This isolation is non-negotiable and must be enforced at every layer.

### What isolation means in practice

| Operational system | Guest Hub relationship | Failure direction |
|---|---|---|
| Reservation engine | Hub links to it; hub does not read from it | Reservation failure ≠ Hub failure |
| Floor management | No relationship | Independent |
| SSE stream | No relationship | Independent |
| Waitlist | Hub links to it; hub does not read from it | Waitlist failure ≠ Hub failure |
| Host session/auth | No relationship — hub is fully public | No auth cookies on guest path |
| Admin portal | Writes hub configuration; never read by hub at runtime | Independent |

### API namespace separation

```
Authenticated operator API:  /api/*         (requires JWT)
Public guest hub API:        /public/hub/*  (no auth, rate-limited, CDN-cacheable)
```

The public hub API is a dedicated read path. It reads from the `guest_hubs`, `brandings`, `menus`, `dishes`, `promotions`, `events`, and `social_links` tables — and only those tables. It never touches `reservations`, `floor_tables`, `waitlist_entries`, or any operational table.

### Failure isolation

- A database connection failure on the analytics write path must not affect hub rendering
- A CDN image failure must not affect hub rendering (gradient fallback is always present)
- A hub page being down must not affect the reservation flow — the two systems have independent health checks
- The guest hub can be put behind a separate Vercel project (or edge function) entirely in Phase 6+, providing true infrastructure isolation

### Rate limiting

Public hub endpoints are rate-limited independently from the operator API:
- Per-IP: 60 requests/minute for page data
- Per-token: 10 requests/minute for QR resolution
- Operator API limits are unaffected by guest hub traffic spikes (e.g., a restaurant going viral)

### Caching

Hub API responses are aggressively cached at the CDN edge:
- Static hub data (branding, menu, social links): 5-minute CDN cache with stale-while-revalidate
- Dish availability: 60-second cache (shorter due to 86'd items)
- Promotions/events: 10-minute cache
- Analytics write calls: never cached, always reach origin

This means a hub serving thousands of concurrent guests during a viral moment does not add meaningful load to the Iron Booking backend.

---

## 10. Suggested Future Phases Roadmap

### Phase 1 — Static foundation ✓ (complete)
Demo page with mock data. Premium mobile-first design. Isolated routing. No backend.

### Phase 2 — Architecture ✓ (this document)
Data models, entity relationships, slug system, i18n strategy, branding philosophy, image strategy, scalability design.

### Phase 3 — Backend scaffolding
- Database tables per Section 3
- `POST /api/hub/publish` — operator publishes a hub
- `GET /public/hub/:slug` — public endpoint serving hub data
- `GET /q/:token` — QR resolution + scan logging
- Slug validation and uniqueness enforcement
- GuestHub → Branding resolution chain

### Phase 4 — Live content connection
- Wire GuestHubPage to real API instead of mockData
- Hero and dish images with blurhash placeholders
- Menu, promotions, events, social links from real data
- Branch hours from the existing restaurant settings

### Phase 5 — Menu viewer
- Category tap opens a slide-up sheet with full dish list
- Dish tap opens dish detail: large image, full description, allergens, variants
- Search within menu
- Availability badge on unavailable dishes

### Phase 6 — Branding system
- Operator preset selection UI in the Iron Booking dashboard
- Logo and hero image upload with focal point selector
- Accent colour picker (within preset constraints)
- Tagline editor
- Preview mode — operators see the hub before publishing

### Phase 7 — Multi-language
- Translation UI in the operator dashboard
- Hebrew, Arabic, French, Spanish as initial targets
- RTL layout for Hebrew/Arabic (logical CSS, dir attribute)
- Language detection and switcher on hub page

### Phase 8 — Analytics
- QR code generator in the operator dashboard
- Hub analytics dashboard: views, CTA conversion, section engagement
- QR scan heatmap by location hint
- Dish engagement metrics (Phase 5+)

### Phase 9 — Multi-branch and groups
- Branch picker page for multi-location restaurants
- HospitalityGroup entity and group discovery page
- Branding inheritance UI (group → restaurant → branch)
- Group analytics aggregation

### Phase 10 — Loyalty and discovery
- Guest profile creation (opt-in, at reservation time)
- Visit history and preferences
- Public search/discovery index
- SEO-optimised hub pages (server-side rendering or static generation)
- Structured data (`schema.org/Restaurant`, `schema.org/Menu`)

### Phase 11 — Commerce and integrations (future)
- POS menu sync (Square, Toast, Lightspeed)
- Live availability updates for 86'd items
- Gift card purchase from hub
- Order-from-table (requires POS integration agreement)
- Ticketed events via integrated booking

---

## Appendix — Type Definitions Reference

```typescript
// Shared value types used across all entities

type UUID = string;
type ISODateString = string;    // "2026-05-15"
type ISOTimestamp  = string;    // "2026-05-15T19:30:00Z"
type ISOLocale     = string;    // "en", "he", "ar", "fr"
type HexColor      = string;    // "#C9A96E"
type RRULE         = string;    // iCal RRULE string
type Blurhash      = string;    // "LGF5]+Yk^6#M@-5c,1J5@[or[Q6"

type Money = {
  amount:   number;   // decimal, stored as integer cents in DB
  currency: string;   // ISO 4217 — "USD", "ILS", "EUR"
};

type LocalisedText = {
  [locale: ISOLocale]: string;
};

type LatLng = {
  lat: number;
  lng: number;
};

type FocalPoint = {
  x: number;   // 0 (left) to 1 (right)
  y: number;   // 0 (top)  to 1 (bottom)
};
```

---

*This document is the strategic foundation for the Iron Booking Guest Hub ecosystem. It should be reviewed and updated at the start of each new phase before implementation begins.*
