/*
 * Jashore360 seed data.
 *
 * status: 'verified' | 'pending' | 'needs_update' | 'temp_closed' | 'closed'
 * demo:   true → নমুনা তথ্য, শুধু UI দেখানোর জন্য। লঞ্চের আগে আসল যাচাইকৃত তথ্য দিয়ে বদলাতে হবে।
 * hours:  '24h' | 'HH:MM-HH:MM' | null (অজানা)
 * off:    সাপ্তাহিক বন্ধের দিন (0=রবি ... 5=শুক্র, 6=শনি)
 * lat/lng: আনুমানিক অবস্থান, শুধু দূরত্ব হিসাবের জন্য। ম্যাপ লিংক নাম দিয়ে খোঁজে।
 * price:  জনপ্রতি আনুমানিক খরচ (টাকা)
 */
window.J360_DATA = {
  areas: [
    'যশোর সদর', 'দড়াটানা', 'চিত্রামোড়', 'পালবাড়ি', 'ঘোপ', 'রেলরোড', 'নিউমার্কেট', 'বেজপাড়া', 'শংকরপুর', 'খড়কি',
    'ঝিকরগাছা', 'চৌগাছা', 'মনিরামপুর', 'কেশবপুর', 'অভয়নগর', 'বাঘারপাড়া', 'শার্শা', 'বেনাপোল'
  ],

  categories: [
    { id: 'emergency', bn: 'জরুরি সেবা', en: 'Emergency', icon: '🚨',
      subs: { hotline: 'জাতীয় হটলাইন', ambulance: 'অ্যাম্বুলেন্স', police: 'পুলিশ', fire: 'ফায়ার সার্ভিস', blood: 'রক্ত',
              women: 'নারী ও শিশু', disaster: 'দুর্যোগ', power: 'বিদ্যুৎ', water: 'পানি', vet: 'পশু চিকিৎসা' },
      keys: ['emergency', 'জরুরি', 'জরুরী', 'jorori', 'police', 'পুলিশ', 'thana', 'থানা', 'fire', 'ফায়ার', 'আগুন', 'ambulance',
             'অ্যাম্বুলেন্স', 'এম্বুলেন্স', 'ambulans', '999', 'helpline', 'হেল্পলাইন', 'বিদ্যুৎ', 'current', 'কারেন্ট', 'পানি', 'water'] },
    { id: 'hospital', bn: 'হাসপাতাল ও স্বাস্থ্য', en: 'Hospitals', icon: '🏥',
      subs: { govt: 'সরকারি হাসপাতাল', private: 'বেসরকারি হাসপাতাল', clinic: 'ক্লিনিক', diagnostic: 'ডায়াগনস্টিক', dental: 'ডেন্টাল',
              eye: 'চক্ষু', pharmacy: 'ফার্মেসি', bloodbank: 'ব্লাড ব্যাংক' },
      keys: ['hospital', 'হাসপাতাল', 'hashpatal', 'haspatal', 'clinic', 'ক্লিনিক', 'doctor', 'ডাক্তার', 'daktar', 'pharmacy',
             'ফার্মেসি', 'ফার্মেসী', 'oshud', 'ওষুধ', 'farmesi', 'medicine', 'diagnostic', 'ডায়াগনস্টিক', 'dentist', 'ডেন্টিস্ট',
             'দাঁত', 'চক্ষু', 'eye', 'চোখ', 'blood', 'রক্ত', 'ব্লাড', 'সাপ', 'snake', 'health', 'স্বাস্থ্য'] },
    { id: 'restaurant', bn: 'রেস্টুরেন্ট ও খাবার', en: 'Restaurants', icon: '🍽️',
      subs: { restaurant: 'রেস্টুরেন্ট', fastfood: 'ফাস্ট ফুড', biryani: 'বিরিয়ানি ও কাচ্চি', cafe: 'কফি ও চা', sweets: 'মিষ্টি ও বেকারি',
              street: 'স্ট্রিট ফুড' },
      keys: ['restaurant', 'resturent', 'restaurent', 'resturant', 'রেস্টুরেন্ট', 'রেস্তোরাঁ', 'হোটেল খাবার', 'food', 'খাবার', 'khabar',
             'biryani', 'biriyani', 'বিরিয়ানি', 'kacchi', 'kachchi', 'কাচ্চি', 'pizza', 'পিজা', 'burger', 'বার্গার', 'cafe', 'coffee',
             'কফি', 'চা', 'tea', 'mishti', 'মিষ্টি', 'sweet', 'bakery', 'বেকারি', 'fuchka', 'ফুচকা', 'eat'] },
    { id: 'shop', bn: 'দোকান ও কেনাকাটা', en: 'Shopping', icon: '🛍️',
      subs: { grocery: 'মুদি ও সুপারশপ', fashion: 'পোশাক ও ফ্যাশন', electronics: 'মোবাইল ও ইলেকট্রনিকস', books: 'বই ও স্টেশনারি',
              hardware: 'হার্ডওয়্যার ও ফার্নিচার', agri: 'কৃষি উপকরণ', gold: 'স্বর্ণ', gift: 'গিফট' },
      keys: ['shop', 'dokan', 'দোকান', 'shopping', 'শপিং', 'market', 'মার্কেট', 'বাজার', 'bazar', 'mobile', 'মোবাইল', 'computer',
             'কম্পিউটার', 'cloth', 'পোশাক', 'জামা', 'saree', 'শাড়ি', 'book', 'বই', 'grocery', 'মুদি', 'supershop', 'সুপারশপ',
             'জুতা', 'shoe', 'furniture', 'ফার্নিচার', 'স্বর্ণ', 'gold', 'বীজ', 'সার', 'seed'] },
    { id: 'place', bn: 'দর্শনীয় স্থান', en: 'Tourist Places', icon: '📍',
      subs: { heritage: 'ঐতিহাসিক', nature: 'প্রকৃতি', park: 'পার্ক ও বিনোদন', religious: 'ধর্মীয় স্থাপনা', market: 'হাট ও বাজার' },
      keys: ['place', 'ঘোরা', 'ঘুরতে', 'ghurte', 'বেড়ানো', 'tour', 'tourist', 'দর্শনীয়', 'park', 'পার্ক', 'picnic', 'পিকনিক',
             'family', 'পরিবার', 'ফুল', 'flower', 'মসজিদ', 'mosque', 'মন্দির', 'temple', 'historical', 'ঐতিহাসিক', 'travel'] },
    { id: 'hotel', bn: 'হোটেল ও থাকা', en: 'Hotels', icon: '🏨',
      subs: { hotel: 'হোটেল', residential: 'আবাসিক হোটেল', guesthouse: 'গেস্ট হাউস', resort: 'রিসোর্ট' },
      keys: ['hotel', 'হোটেল', 'residential', 'আবাসিক', 'guest house', 'গেস্ট হাউস', 'resort', 'রিসোর্ট', 'থাকার', 'room', 'রুম'] },
    { id: 'service', bn: 'লোকাল সার্ভিস', en: 'Local Services', icon: '🔧',
      subs: { electrician: 'ইলেকট্রিশিয়ান', plumber: 'প্লাম্বার', ac: 'এসি ও ফ্রিজ মেরামত', mobile: 'মোবাইল সার্ভিসিং',
              photo: 'ফটোগ্রাফার', parlour: 'বিউটি পার্লার', tailor: 'দর্জি', vehicle: 'গাড়ি/বাইক মেরামত', shifting: 'বাসা বদল' },
      keys: ['service', 'সার্ভিস', 'servicing', 'সার্ভিসিং', 'mistri', 'মিস্ত্রি', 'electrician', 'ইলেকট্রিশিয়ান', 'plumber',
             'প্লাম্বার', 'ac', 'এসি', 'fridge', 'ফ্রিজ', 'repair', 'মেরামত', 'photographer', 'ফটোগ্রাফার', 'parlour', 'parlor',
             'পার্লার', 'tailor', 'দর্জি', 'bike', 'বাইক', 'garage', 'গ্যারেজ', 'shifting'] },
    { id: 'education', bn: 'শিক্ষা', en: 'Education', icon: '📚',
      subs: { school: 'স্কুল', college: 'কলেজ', university: 'বিশ্ববিদ্যালয়', madrasa: 'মাদ্রাসা', coaching: 'কোচিং ও প্রশিক্ষণ', library: 'লাইব্রেরি' },
      keys: ['school', 'স্কুল', 'college', 'কলেজ', 'university', 'বিশ্ববিদ্যালয়', 'versity', 'ভার্সিটি', 'madrasa', 'মাদ্রাসা',
             'coaching', 'কোচিং', 'library', 'লাইব্রেরি', 'পাঠাগার', 'education', 'শিক্ষা', 'training', 'প্রশিক্ষণ'] }
  ],

  /* রেটিংয়ের আলাদা মানদণ্ড, ক্যাটাগরি অনুযায়ী */
  criteria: {
    restaurant: ['খাবারের মান', 'পরিচ্ছন্নতা', 'সার্ভিস', 'দাম অনুযায়ী মান'],
    shop: ['পণ্যের মান', 'দাম', 'ব্যবহার', 'বিক্রয়-পরবর্তী সেবা'],
    hospital: ['তথ্যের স্বচ্ছতা', 'পরিষেবা ব্যবস্থাপনা', 'পরিবেশ ও পরিচ্ছন্নতা'],
    hotel: ['রুম', 'পরিচ্ছন্নতা', 'সার্ভিস', 'দাম অনুযায়ী মান'],
    service: ['কাজের মান', 'সময়ানুবর্তিতা', 'দাম'],
    place: ['পরিবেশ', 'যাতায়াত', 'সুযোগ-সুবিধা'],
    education: ['পরিবেশ', 'তথ্যের স্বচ্ছতা', 'সুযোগ-সুবিধা']
  },

  items: [
    /* ---------- জাতীয় হটলাইন (বাংলাদেশ) ---------- */
    { id: 'e999', cat: 'emergency', sub: 'hotline', name: 'জাতীয় জরুরি সেবা ৯৯৯', nameEn: 'National Emergency 999',
      phone: '999', hours: '24h', status: 'verified', note: 'পুলিশ, ফায়ার সার্ভিস ও অ্যাম্বুলেন্স — বিনা খরচে', tags: ['police', 'fire', 'ambulance', 'পুলিশ', 'অ্যাম্বুলেন্স', 'ambulance'], pin: true },
    { id: 'e16163', cat: 'emergency', sub: 'fire', name: 'ফায়ার সার্ভিস ও সিভিল ডিফেন্স হটলাইন', nameEn: 'Fire Service Hotline',
      phone: '16163', hours: '24h', status: 'verified', note: 'অগ্নিকাণ্ড ও উদ্ধার', tags: ['fire', 'আগুন'] },
    { id: 'e16263', cat: 'emergency', sub: 'hotline', name: 'স্বাস্থ্য বাতায়ন', nameEn: 'Shastho Batayon (Health)',
      phone: '16263', hours: '24h', status: 'verified', note: 'ফোনে চিকিৎসকের পরামর্শ ও স্বাস্থ্য তথ্য', tags: ['doctor', 'ডাক্তার', 'health'] },
    { id: 'e109', cat: 'emergency', sub: 'women', name: 'নারী ও শিশু নির্যাতন প্রতিরোধ হেল্পলাইন', nameEn: 'Women & Child Helpline',
      phone: '109', hours: '24h', status: 'verified', note: 'বিনা খরচে', tags: ['women', 'নারী', 'শিশু'] },
    { id: 'e1098', cat: 'emergency', sub: 'women', name: 'চাইল্ড হেল্পলাইন', nameEn: 'Child Helpline',
      phone: '1098', hours: '24h', status: 'verified', note: 'শিশুদের সুরক্ষা ও সহায়তা', tags: ['child', 'শিশু'] },
    { id: 'e1090', cat: 'emergency', sub: 'disaster', name: 'দুর্যোগের আগাম বার্তা', nameEn: 'Disaster Early Warning',
      phone: '1090', hours: '24h', status: 'verified', note: 'আবহাওয়া ও দুর্যোগ সতর্কবার্তা', tags: ['ঝড়', 'বন্যা', 'weather'] },
    { id: 'e333', cat: 'emergency', sub: 'hotline', name: 'জাতীয় কল সেন্টার ৩৩৩', nameEn: 'National Call Centre 333',
      phone: '333', hours: '24h', status: 'verified', note: 'সরকারি সেবা ও তথ্য', tags: ['govt', 'সরকারি'] },

    /* ---------- স্থানীয় জরুরি (যাচাই চলছে, নম্বর পরে যুক্ত হবে) ---------- */
    { id: 'e-kotwali', cat: 'emergency', sub: 'police', name: 'যশোর কোতোয়ালি মডেল থানা', nameEn: 'Jashore Kotwali Model Thana',
      area: 'যশোর সদর', hours: '24h', status: 'pending', lat: 23.1676, lng: 89.2117 },
    { id: 'e-benapole-ps', cat: 'emergency', sub: 'police', name: 'বেনাপোল পোর্ট থানা', nameEn: 'Benapole Port Thana',
      area: 'বেনাপোল', hours: '24h', status: 'pending', lat: 23.0425, lng: 88.8950 },
    { id: 'e-fire-jsr', cat: 'emergency', sub: 'fire', name: 'যশোর ফায়ার সার্ভিস স্টেশন', nameEn: 'Jashore Fire Station',
      area: 'যশোর সদর', hours: '24h', status: 'pending', lat: 23.1690, lng: 89.2050 },
    { id: 'e-amb-gh', cat: 'emergency', sub: 'ambulance', name: 'জেনারেল হাসপাতাল অ্যাম্বুলেন্স', nameEn: 'General Hospital Ambulance',
      area: 'যশোর সদর', hours: '24h', status: 'pending', lat: 23.1650, lng: 89.2125 },
    { id: 'e-power', cat: 'emergency', sub: 'power', name: 'বিদ্যুৎ অভিযোগ কেন্দ্র (যশোর)', nameEn: 'Power Complaint Centre',
      area: 'যশোর সদর', hours: null, status: 'pending' },
    { id: 'e-water', cat: 'emergency', sub: 'water', name: 'পৌরসভা পানি সরবরাহ শাখা', nameEn: 'Municipality Water Supply',
      area: 'যশোর সদর', hours: null, status: 'pending' },
    { id: 'e-vet', cat: 'emergency', sub: 'vet', name: 'জেলা ভেটেরিনারি হাসপাতাল', nameEn: 'District Veterinary Hospital',
      area: 'যশোর সদর', hours: null, status: 'pending' },

    /* ---------- হাসপাতাল ---------- */
    { id: 'h-general', cat: 'hospital', sub: 'govt', name: '২৫০ শয্যা জেনারেল হাসপাতাল, যশোর', nameEn: '250 Bed General Hospital Jashore',
      area: 'যশোর সদর', hours: '24h', status: 'pending', emergency: true, lat: 23.1650, lng: 89.2125,
      tags: ['সদর হাসপাতাল', 'sadar hospital', 'জরুরি বিভাগ', 'সাপ', 'snake'],
      note: 'সাপে কামড়ালে দ্রুত সরকারি হাসপাতালে যান। অ্যান্টিভেনম প্রাপ্যতা আগে ফোনে নিশ্চিত করুন।' },
    { id: 'h-cmh', cat: 'hospital', sub: 'govt', name: 'সম্মিলিত সামরিক হাসপাতাল (সিএমএইচ), যশোর', nameEn: 'CMH Jashore',
      area: 'যশোর সদর', hours: '24h', status: 'pending', lat: 23.1850, lng: 89.1650 },
    ...[['jhikargachha', 'ঝিকরগাছা', 'Jhikargachha', 23.10, 89.10], ['chougachha', 'চৌগাছা', 'Chougachha', 23.26, 89.03],
        ['monirampur', 'মনিরামপুর', 'Monirampur', 23.01, 89.24], ['keshabpur', 'কেশবপুর', 'Keshabpur', 22.91, 89.22],
        ['abhaynagar', 'অভয়নগর', 'Abhaynagar', 23.02, 89.42], ['bagherpara', 'বাঘারপাড়া', 'Bagherpara', 23.22, 89.35],
        ['sharsha', 'শার্শা', 'Sharsha', 23.08, 88.97]].map(([k, bn, en, lat, lng]) => ({
      id: 'h-uhc-' + k, cat: 'hospital', sub: 'govt', name: bn + ' উপজেলা স্বাস্থ্য কমপ্লেক্স', nameEn: en + ' Upazila Health Complex',
      area: bn, hours: '24h', status: 'pending', emergency: true, lat, lng, tags: ['সাপ', 'snake', 'উপজেলা'] })),
    { id: 'h-demo-clinic', cat: 'hospital', sub: 'clinic', name: 'নমুনা ক্লিনিক', nameEn: 'Sample Clinic', area: 'ঘোপ',
      hours: '08:00-22:00', status: 'pending', demo: true, lat: 23.1720, lng: 89.2160 },
    { id: 'h-demo-diag', cat: 'hospital', sub: 'diagnostic', name: 'নমুনা ডায়াগনস্টিক সেন্টার', nameEn: 'Sample Diagnostic Centre',
      area: 'রেলরোড', hours: '07:00-23:00', status: 'pending', demo: true, lat: 23.1640, lng: 89.2060 },
    { id: 'h-demo-pharma', cat: 'hospital', sub: 'pharmacy', name: 'নমুনা ২৪ ঘণ্টা ফার্মেসি', nameEn: 'Sample 24h Pharmacy',
      area: 'যশোর সদর', hours: '24h', status: 'pending', demo: true, lat: 23.1655, lng: 89.2120, tags: ['ওষুধ', 'medicine'] },

    /* ---------- রেস্টুরেন্ট (সব নমুনা) ---------- */
    { id: 'r-demo-1', cat: 'restaurant', sub: 'biryani', name: 'নমুনা কাচ্চি ঘর', nameEn: 'Sample Kacchi Ghor', area: 'দড়াটানা',
      hours: '11:00-23:00', price: 250, status: 'pending', demo: true, lat: 23.1680, lng: 89.2090,
      features: ['বসে খাওয়া', 'ফ্যামিলি সিট', 'হোম ডেলিভারি'], tags: ['kacchi', 'biryani', 'তেহারি'] },
    { id: 'r-demo-2', cat: 'restaurant', sub: 'fastfood', name: 'নমুনা বার্গার পয়েন্ট', nameEn: 'Sample Burger Point', area: 'চিত্রামোড়',
      hours: '12:00-23:30', price: 180, status: 'pending', demo: true, lat: 23.1660, lng: 89.2000,
      features: ['বসে খাওয়া', 'হোম ডেলিভারি'], tags: ['pizza', 'burger', 'পিজা'], sponsored: true },
    { id: 'r-demo-3', cat: 'restaurant', sub: 'cafe', name: 'নমুনা চা-কফি কর্নার', nameEn: 'Sample Tea Coffee Corner', area: 'পালবাড়ি',
      hours: '08:00-22:00', price: 80, status: 'pending', demo: true, lat: 23.1750, lng: 89.1950, tags: ['tea', 'coffee'] },
    { id: 'r-demo-4', cat: 'restaurant', sub: 'restaurant', name: 'নমুনা ফ্যামিলি রেস্টুরেন্ট', nameEn: 'Sample Family Restaurant',
      area: 'নিউমার্কেট', hours: '10:00-23:00', price: 400, status: 'pending', demo: true, lat: 23.1700, lng: 89.2140,
      features: ['ফ্যামিলি সিট', 'পার্কিং', 'বুফে'], tags: ['বাংলা খাবার', 'chinese', 'চাইনিজ'] },
    { id: 'r-demo-5', cat: 'restaurant', sub: 'sweets', name: 'নমুনা মিষ্টিমুখ', nameEn: 'Sample Mishtimukh', area: 'বেজপাড়া',
      hours: '07:00-22:00', price: 100, status: 'pending', demo: true, lat: 23.1620, lng: 89.2080, tags: ['জামতলার মিষ্টি', 'দই', 'sweet'] },
    { id: 'r-demo-6', cat: 'restaurant', sub: 'street', name: 'নমুনা ফুচকা চটপটি', nameEn: 'Sample Fuchka Chotpoti', area: 'খড়কি',
      hours: '15:00-22:00', price: 60, status: 'pending', demo: true, lat: 23.1600, lng: 89.1950, tags: ['fuchka', 'চটপটি'] },

    /* ---------- দোকান (সব নমুনা) ---------- */
    { id: 's-demo-1', cat: 'shop', sub: 'electronics', name: 'নমুনা মোবাইল জোন', nameEn: 'Sample Mobile Zone', area: 'নিউমার্কেট',
      hours: '10:00-21:00', off: [5], status: 'pending', demo: true, lat: 23.1705, lng: 89.2135, features: ['হোম ডেলিভারি'] },
    { id: 's-demo-2', cat: 'shop', sub: 'fashion', name: 'নমুনা শাড়ি ও থ্রি-পিস', nameEn: 'Sample Saree House', area: 'দড়াটানা',
      hours: '10:00-21:00', status: 'pending', demo: true, lat: 23.1685, lng: 89.2095, tags: ['saree', 'থ্রি পিস'] },
    { id: 's-demo-3', cat: 'shop', sub: 'grocery', name: 'নমুনা সুপারশপ', nameEn: 'Sample Super Shop', area: 'ঘোপ',
      hours: '08:00-22:00', status: 'pending', demo: true, lat: 23.1725, lng: 89.2170, features: ['হোম ডেলিভারি', 'পার্কিং'] },
    { id: 's-demo-4', cat: 'shop', sub: 'books', name: 'নমুনা বইঘর', nameEn: 'Sample Boighor', area: 'রেলরোড',
      hours: '09:00-21:00', off: [5], status: 'pending', demo: true, lat: 23.1645, lng: 89.2065 },
    { id: 's-demo-5', cat: 'shop', sub: 'agri', name: 'নমুনা বীজ ও সার ভাণ্ডার', nameEn: 'Sample Seed & Fertilizer', area: 'ঝিকরগাছা',
      hours: '08:00-20:00', status: 'pending', demo: true, lat: 23.10, lng: 89.10 },

    /* ---------- দর্শনীয় স্থান ---------- */
    { id: 'p-sagardari', cat: 'place', sub: 'heritage', name: 'সাগরদাঁড়ি — মাইকেল মধুসূদন দত্তের বাড়ি', nameEn: 'Sagardari, Madhusudan Dutt Home',
      area: 'কেশবপুর', status: 'pending', lat: 22.87, lng: 89.23, tags: ['মধুসূদন', 'কপোতাক্ষ', 'মধুমেলা', 'family'],
      note: 'মহাকবি মাইকেল মধুসূদন দত্তের জন্মস্থান, কপোতাক্ষ নদের তীরে।' },
    { id: 'p-godkhali', cat: 'place', sub: 'nature', name: 'গদখালী ফুলের রাজ্য', nameEn: 'Godkhali Flower Fields',
      area: 'ঝিকরগাছা', status: 'pending', lat: 23.08, lng: 89.12, tags: ['ফুল', 'flower', 'photo', 'ছবি', 'family'],
      note: 'দেশের অন্যতম বড় ফুল চাষের এলাকা ও ফুলের পাইকারি বাজার।' },
    { id: 'p-jhapa', cat: 'place', sub: 'nature', name: 'ঝাঁপা বাঁওড় ও ভাসমান সেতু', nameEn: 'Jhapa Baor Floating Bridge',
      area: 'মনিরামপুর', status: 'pending', lat: 23.03, lng: 89.20, tags: ['বাঁওড়', 'সেতু', 'family', 'picnic'] },
    { id: 'p-chanchra', cat: 'place', sub: 'heritage', name: 'চাঁচড়া রাজবাড়ি ও শিবমন্দির', nameEn: 'Chanchra Rajbari & Shiva Temple',
      area: 'যশোর সদর', status: 'pending', lat: 23.150, lng: 89.205, tags: ['রাজবাড়ি', 'মন্দির', 'temple', 'historical'] },
    { id: 'p-institute', cat: 'place', sub: 'heritage', name: 'যশোর ইনস্টিটিউট পাবলিক লাইব্রেরি', nameEn: 'Jashore Institute Public Library',
      area: 'দড়াটানা', status: 'pending', lat: 23.1670, lng: 89.2100, tags: ['library', 'লাইব্রেরি', 'ঐতিহ্য'] },
    { id: 'p-benapole', cat: 'place', sub: 'market', name: 'বেনাপোল স্থলবন্দর', nameEn: 'Benapole Land Port',
      area: 'বেনাপোল', status: 'pending', lat: 23.0425, lng: 88.8900, tags: ['border', 'সীমান্ত', 'port'] },

    /* ---------- হোটেল (নমুনা) ---------- */
    { id: 'ht-demo-1', cat: 'hotel', sub: 'residential', name: 'নমুনা আবাসিক হোটেল', nameEn: 'Sample Residential Hotel', area: 'রেলরোড',
      hours: '24h', price: 1200, status: 'pending', demo: true, lat: 23.1642, lng: 89.2070, features: ['এসি রুম', 'ওয়াই-ফাই', 'পার্কিং'] },
    { id: 'ht-demo-2', cat: 'hotel', sub: 'guesthouse', name: 'নমুনা গেস্ট হাউস', nameEn: 'Sample Guest House', area: 'শংকরপুর',
      hours: '24h', price: 900, status: 'pending', demo: true, lat: 23.1600, lng: 89.2150, features: ['ফ্যামিলি রুম'] },

    /* ---------- সার্ভিস (নমুনা) ---------- */
    { id: 'sv-demo-1', cat: 'service', sub: 'electrician', name: 'নমুনা ইলেকট্রিক সার্ভিস', nameEn: 'Sample Electric Service', area: 'ঘোপ',
      hours: '09:00-20:00', price: 300, status: 'pending', demo: true, lat: 23.1730, lng: 89.2180 },
    { id: 'sv-demo-2', cat: 'service', sub: 'ac', name: 'নমুনা এসি-ফ্রিজ কেয়ার', nameEn: 'Sample AC Fridge Care', area: 'পালবাড়ি',
      hours: '09:00-21:00', price: 500, status: 'pending', demo: true, lat: 23.1755, lng: 89.1960 },
    { id: 'sv-demo-3', cat: 'service', sub: 'photo', name: 'নমুনা ফটোগ্রাফি', nameEn: 'Sample Photography', area: 'যশোর সদর',
      hours: null, status: 'pending', demo: true, tags: ['wedding', 'বিয়ে', 'video', 'ভিডিও'] },

    /* ---------- শিক্ষা ---------- */
    { id: 'ed-just', cat: 'education', sub: 'university', name: 'যশোর বিজ্ঞান ও প্রযুক্তি বিশ্ববিদ্যালয় (যবিপ্রবি)', nameEn: 'Jashore University of Science & Technology (JUST)',
      area: 'যশোর সদর', status: 'pending', lat: 23.233, lng: 89.125, tags: ['just', 'যবিপ্রবি'] },
    { id: 'ed-jmc', cat: 'education', sub: 'college', name: 'যশোর মেডিকেল কলেজ', nameEn: 'Jashore Medical College',
      area: 'যশোর সদর', status: 'pending', tags: ['medical'] },
    { id: 'ed-mm', cat: 'education', sub: 'college', name: 'সরকারি মাইকেল মধুসূদন কলেজ', nameEn: 'Govt. Michael Madhusudan College',
      area: 'যশোর সদর', status: 'pending', tags: ['mm college', 'এমএম কলেজ'] },
    { id: 'ed-zilla', cat: 'education', sub: 'school', name: 'যশোর জিলা স্কুল', nameEn: 'Jashore Zilla School',
      area: 'যশোর সদর', status: 'pending' }
  ]
};
