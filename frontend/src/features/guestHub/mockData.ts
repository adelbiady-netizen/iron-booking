export interface Dish {
  id: string;
  name: string;
  description: string;
  price: string;
  tag?: string;
  gradient: string;
}

export interface MenuCategory {
  id: string;
  name: string;
  count: number;
}

export interface Promotion {
  id: string;
  title: string;
  description: string;
  schedule?: string;
  tag?: string;
  tagColor?: 'gold' | 'stone';
}

export interface MockRestaurant {
  name: string;
  tagline: string;
  phone: string;
  address: string;
  directionsUrl: string;
  instagram?: string;
  tiktok?: string;
  website?: string;
  hours: { label: string; value: string }[];
  featuredDishes: Dish[];
  menuCategories: MenuCategory[];
  promotions: Promotion[];
}

export const mockRestaurant: MockRestaurant = {
  name: 'Ember & Stone',
  tagline: 'Where fire meets flavour — an intimate dining experience',
  phone: '+1 212 555 0190',
  address: '142 West 57th Street, New York, NY 10019',
  directionsUrl: 'https://maps.google.com/?q=142+West+57th+Street+New+York+NY',
  instagram: 'emberandstone',
  tiktok: 'emberandstone',
  website: 'emberandstone.com',
  hours: [
    { label: 'Mon – Thu', value: '6:00 pm – 10:30 pm' },
    { label: 'Fri – Sat', value: '6:00 pm – 11:30 pm' },
    { label: 'Sunday', value: 'Closed' },
  ],
  featuredDishes: [
    {
      id: '1',
      name: 'Wagyu Tartare',
      description: 'A5 wagyu, truffle emulsion, quail egg, brioche',
      price: '$38',
      tag: "Chef's pick",
      gradient: 'linear-gradient(135deg, #3D1A0E 0%, #1A0C08 100%)',
    },
    {
      id: '2',
      name: 'Charred Octopus',
      description: 'Smoked paprika, preserved lemon, saffron aioli',
      price: '$29',
      gradient: 'linear-gradient(135deg, #0E2030 0%, #081018 100%)',
    },
    {
      id: '3',
      name: 'Saffron Risotto',
      description: 'Aged Parmigiano, black truffle, verjuice reduction',
      price: '$32',
      tag: 'Seasonal',
      gradient: 'linear-gradient(135deg, #2A1A06 0%, #130E04 100%)',
    },
    {
      id: '4',
      name: 'Dry-Aged Duck',
      description: '21-day aged, cherry jus, pomme terrine',
      price: '$44',
      gradient: 'linear-gradient(135deg, #1A0A0A 0%, #0D0505 100%)',
    },
    {
      id: '5',
      name: 'Valrhona Soufflé',
      description: '72% dark chocolate, vanilla bean crème',
      price: '$18',
      gradient: 'linear-gradient(135deg, #1C0E14 0%, #0D0608 100%)',
    },
  ],
  menuCategories: [
    { id: '1', name: 'Starters',       count: 8  },
    { id: '2', name: 'Mains',          count: 12 },
    { id: '3', name: 'Desserts',       count: 6  },
    { id: '4', name: 'Wine & Spirits', count: 40 },
    { id: '5', name: 'Cocktails',      count: 14 },
    { id: '6', name: 'Non-Alcoholic',  count: 8  },
  ],
  promotions: [
    {
      id: '1',
      title: "Chef's Table — Friday Evening",
      description:
        'An exclusive 8-course tasting menu prepared tableside by Chef Marco. Limited to 6 guests per seating.',
      schedule: 'Every Friday from 7:00 pm',
      tag: 'Exclusive',
      tagColor: 'gold',
    },
    {
      id: '2',
      title: 'Summer Truffle Season',
      description:
        'A special menu celebrating the finest summer truffles from Périgord, available through end of August.',
      tag: 'Limited time',
      tagColor: 'stone',
    },
    {
      id: '3',
      title: 'Sunday Garden Brunch',
      description:
        'A relaxed exploration of seasonal produce, from morning pastries to dessert wine.',
      schedule: 'Sundays, 11:00 am – 3:00 pm',
    },
  ],
};
