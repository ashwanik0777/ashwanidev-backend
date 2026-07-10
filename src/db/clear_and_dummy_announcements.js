/**
 * Database Script: clear_and_dummy_announcements.js
 * 1. Clears all notices, news, newsletters, events tables.
 * 2. Clears all JSONB content columns of all schools in the schools table.
 * 3. Seed central tables with dummy college-level records.
 * 4. Seed GBU and SOICT schools with school-level and college-level dummy data.
 */

const { Pool } = require('pg');

const DATABASE_URL = 'postgresql://neondb_owner:npg_gmyJkt3c4xDh@ep-steep-art-a10yu9l2-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  console.log('🔄 Connecting to database and running clear + dummy seeding...');

  // 1. Clear notices, news, newsletters, events tables
  console.log('🧹 Truncating central tables...');
  await pool.query('TRUNCATE TABLE public."notices" RESTART IDENTITY CASCADE;');
  await pool.query('TRUNCATE TABLE public."news" RESTART IDENTITY CASCADE;');
  await pool.query('TRUNCATE TABLE public."newsletters" RESTART IDENTITY CASCADE;');
  await pool.query('TRUNCATE TABLE public."events" RESTART IDENTITY CASCADE;');

  // 2. Clear schools table content columns to default empty object {}
  console.log('🧹 Clearing schools JSONB content columns...');
  await pool.query('UPDATE public."schools" SET content = \'{}\'::jsonb;');

  // 3. Seed central notices table with dummy college-level record
  console.log('🌱 Seeding central notices table...');
  await pool.query(`
    INSERT INTO public."notices" (title, content, published_date, type, priority, views, is_new, pdf_url)
    VALUES (
      'Global Notice: GBU Central Library Extended Study Hours',
      'The central library will remain open 24/7 during the upcoming end-semester examinations. Students must carry their valid university ID cards for entry.',
      '2026-07-09',
      'General',
      'medium',
      120,
      true,
      'https://gbu.ac.in/notices/library-extended-timings-2026.pdf'
    );
  `);

  // Seed central news table
  console.log('🌱 Seeding central news table...');
  await pool.query(`
    INSERT INTO public."news" (title, excerpt, content, author, department, category, published_date, priority, views, likes, is_featured, status, image_url, tags)
    VALUES (
      'Global News: GBU Ranked Top in Innovation Survey 2026',
      'Gautam Buddha University has secured the top rank in regional innovation research surveys.',
      'Our ongoing research initiatives, patents filed by schools, and start-up incubation projects have positioned GBU as a leading research university.',
      'Research Cell Admin',
      'Research Cell',
      'Research',
      '2026-07-08',
      'high',
      450,
      72,
      true,
      'published',
      'https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=1200',
      '["Innovation", "Research", "Ranking"]'::jsonb
    );
  `);

  // Seed central newsletters table
  console.log('🌱 Seeding central newsletters table...');
  await pool.query(`
    INSERT INTO public."newsletters" (title, issue_number, published_date, cover_image_url, excerpt, pdf_url, views, category)
    VALUES (
      'Global Newsletter: GBU Monthly Chronicles - July 2026',
      'Vol. 18, Issue 7',
      '2026-07-10',
      'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=1200',
      'Catch up on recent updates, placement success stories, and upcoming events.',
      '/newsletters/monthly-chronicles-july-2026.pdf',
      85,
      'University Update'
    );
  `);

  // Seed central events table
  console.log('🌱 Seeding central events table...');
  await pool.query(`
    INSERT INTO public."events" (title, description, organizer, venue, type, mode, status, price, attendees, starts_at, ends_at, time_string, year, cover_image, registration_url, tags)
    VALUES (
      'Global Event: 16th Convocation Ceremony',
      'Join us for the 16th annual GBU convocation ceremony welcoming eminent guests and honoring graduating scholars.',
      'Convocation Committee',
      'Main Auditorium',
      'Convocation',
      'Offline',
      'Upcoming',
      'Free',
      1200,
      '2026-08-15 10:00:00',
      '2026-08-15 14:00:00',
      '10:00 AM - 02:00 PM',
      '2026',
      'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=1200',
      'https://gbu.ac.in/convocation-2026',
      '["Graduation", "Convocation", "Ceremony"]'::jsonb
    );
  `);

  // 4. Update school "SOICT" with school-level and college-level data in content JSONB column
  console.log('🌱 Seeding School-level data for SOICT school...');
  const soictContent = {
    deanName: "Dr. Sanjay Kumar Sharma",
    email: "dean.soict@gbu.ac.in",
    phone: "+91-120-2344200",
    websiteUrl: "https://gbu.ac.in/soict",
    bannerImage: "https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200",
    address: "School of ICT Block, Gautam Buddha University Campus, Greater Noida, UP - 201312",
    notices: [
      {
        id: "soict-notice-1",
        title: "SOICT Mid-Term Examination Postponed (Even Sem 2026)",
        date: "2026-07-09",
        type: "Examination",
        priority: "high",
        level: "school",
        pdfUrl: "https://gbu.ac.in/notices/soict-exams-postponed.pdf",
        content: "Mid-Term exams scheduled for July 12 have been rescheduled to July 15 due to administrative adjustments.",
        views: 12,
        isNew: true
      },
      {
        id: "soict-notice-2",
        title: "SOICT Annual Technical Symposium - TechGala 2026",
        date: "2026-07-10",
        type: "Academic",
        priority: "medium",
        level: "college",
        pdfUrl: "https://gbu.ac.in/notices/techgala-symposium.pdf",
        content: "TechGala 2026 national technical symposium registration portal is open to all university departments.",
        views: 45,
        isNew: true
      }
    ],
    news: [
      {
        id: "soict-news-1",
        title: "SOICT Student Team Wins Smart India Hackathon 2026 First Prize",
        date: "2026-07-08",
        category: "Achievement",
        author: "SOICT Placement Cell",
        department: "Computer Science",
        tags: "hackathon, victory, smart india",
        priority: "high",
        featured: true,
        views: 95,
        likes: 18,
        image: "https://images.unsplash.com/photo-1515187029135-18ee286d815b?w=1200",
        imageLink: "",
        pdfUrl: "",
        link: "",
        excerpt: "Our team bagged the first place award with a prize pool of 1 Lakh INR.",
        content: "The team developed a secure decentralized IoT device tracking prototype using blockchain systems.",
        level: "school",
        status: "published"
      },
      {
        id: "soict-news-2",
        title: "SOICT Cyber Security Excellence Lab Inauguration",
        date: "2026-07-07",
        category: "Infrastructure",
        author: "Dean Office",
        department: "Information Technology",
        tags: "lab, cyber security, infrastructure",
        priority: "medium",
        featured: false,
        views: 64,
        likes: 12,
        image: "https://images.unsplash.com/photo-1515879218367-8466d910aaa4?w=1200",
        imageLink: "",
        pdfUrl: "",
        link: "",
        excerpt: "A state-of-the-art laboratory for cyber security research and analytics was inaugurated.",
        content: "Equipped with advanced intrusion detection and network diagnostic tools for student training.",
        level: "college",
        status: "published"
      }
    ],
    events: [
      {
        id: "soict-event-1",
        title: "SOICT Hands-on Blockchain Development Workshop",
        date: "2026-07-15",
        startsAt: "10:00",
        endDate: "2026-07-15",
        endsAt: "16:00",
        time: "10:00 AM - 04:00 PM",
        venue: "Advanced Computing Lab",
        location: "ICT Block",
        type: "Workshop",
        mode: "Offline",
        organizer: "SOICT Coding Club",
        attendees: 60,
        price: "Free",
        tags: "blockchain, workshop, hands-on",
        image: "https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=1200",
        imageLink: "",
        coverImageUrl: "",
        images: "",
        registrationUrl: "https://gbu.ac.in/soict-blockchain-workshop",
        level: "school",
        description: "Intensive training on Ethereum smart contract compilation and deployment utilizing solidity."
      },
      {
        id: "soict-event-2",
        title: "SOICT Seminar on Next-Gen Generative AI Networks",
        date: "2026-07-18",
        startsAt: "11:30",
        endDate: "2026-07-18",
        endsAt: "13:30",
        time: "11:30 AM - 01:30 PM",
        venue: "Seminar Hall 1",
        location: "ICT Block",
        type: "Seminar",
        mode: "Offline",
        organizer: "AI & ML Department",
        attendees: 120,
        price: "Free",
        tags: "ai, generative networks, neural systems",
        image: "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=1200",
        imageLink: "",
        coverImageUrl: "",
        images: "",
        registrationUrl: "",
        level: "college",
        description: "An open guest lecture explaining generative neural systems architectures and stable diffusion paradigms."
      }
    ],
    newsletters: [
      {
        id: "soict-nl-1",
        title: "SOICT Byte-Sized Monthly Newsletter - July 2026",
        date: "2026-07-10",
        category: "School Update",
        issueNumber: "Vol. 6, Issue 7",
        views: 24,
        coverImage: "https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200",
        imageLink: "",
        pdfLink: "/newsletters/soict-july-2026.pdf",
        excerpt: "Monthly wrap-up of SOICT student publications and placement milestones.",
        content: "Highlights include 3 student publications, 18 offers from top tier recruiters, and research accomplishments.",
        isPublished: true
      }
    ],
    eventGallery: [
      {
        id: "soict-gallery-1",
        title: "SOICT Smart India Hackathon Winners Ceremony",
        eventDate: "2026-07-09",
        category: "Events",
        imageUrl: "https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=1200",
        images: ["https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=1200"],
        imageLink: ""
      }
    ]
  };

  await pool.query(
    'UPDATE public."schools" SET content = $1 WHERE code = \'SOICT\';',
    [JSON.stringify(soictContent)]
  );

  // 5. Seed GBU pseudo-school with dummy announcements
  console.log('🌱 Seeding School-level data for GBU administration...');
  const gbuContent = {
    deanName: "Prof. R.K. Sinha",
    email: "vc@gbu.ac.in",
    phone: "+91-120-2344000",
    websiteUrl: "https://gbu.ac.in",
    bannerImage: "https://images.unsplash.com/photo-1541339907198-e08756dedf3f?w=1200",
    address: "Yamuna Expressway, Greater Noida, Gautam Buddha Nagar, UP - 201312",
    notices: [
      {
        id: "gbu-notice-1",
        title: "GBU Campus Green Drive Initiative",
        date: "2026-07-10",
        type: "General",
        priority: "low",
        level: "school",
        pdfUrl: "",
        content: "A tree plantation campaign is organized by campus estate office near GBU sports stadium complex.",
        views: 8,
        isNew: true
      }
    ],
    news: [
      {
        id: "gbu-news-1",
        title: "GBU Hosts International Yoga Day Celebrations",
        date: "2026-06-21",
        category: "University Event",
        author: "Registrar",
        department: "Administration",
        tags: "yoga, international, fitness",
        priority: "medium",
        featured: false,
        views: 180,
        likes: 35,
        image: "https://images.unsplash.com/photo-1506157786151-b8491531f063?w=1200",
        imageLink: "",
        pdfUrl: "",
        link: "",
        excerpt: "Students and administrative faculty members joined yoga sessions in university central park.",
        content: "The event featured experts demonstrating yogic kriyas and delivering lectures explaining wellness.",
        level: "college",
        status: "published"
      }
    ],
    events: [
      {
        id: "gbu-event-1",
        title: "GBU Annual Cultural Festival - Abhivyakti 2026",
        date: "2026-09-10",
        startsAt: "09:00",
        endDate: "2026-09-12",
        endsAt: "21:00",
        time: "09:00 AM - 09:00 PM",
        venue: "Eklavya Sports Stadium",
        location: "University Sports Arena",
        type: "Cultural Festival",
        mode: "Offline",
        organizer: "Cultural Committee Office",
        attendees: 3000,
        price: "Free",
        tags: "cultural, festival, music, dance",
        image: "https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=1200",
        imageLink: "",
        coverImageUrl: "",
        images: "",
        registrationUrl: "https://gbu.ac.in/abhivyakti-2026",
        level: "college",
        description: "Three day inter-college cultural gala comprising dance, drama, band battles, and guest concerts."
      }
    ],
    newsletters: [
      {
        id: "gbu-nl-1",
        title: "GBU Administration Annual Report 2025-26",
        date: "2026-06-30",
        category: "Annual Report",
        issueNumber: "Vol. 2026",
        views: 150,
        coverImage: "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=1200",
        imageLink: "",
        pdfLink: "/newsletters/gbu-annual-report-2026.pdf",
        excerpt: "Comprehensive view of Gautam Buddha University advancements and research publications.",
        content: "Detailed analytical metrics on infrastructure expansion, funding allocations, and academic growth.",
        isPublished: true
      }
    ],
    eventGallery: [
      {
        id: "gbu-gallery-1",
        title: "GBU International Yoga Day Highlights",
        eventDate: "2026-06-21",
        category: "Events",
        imageUrl: "https://images.unsplash.com/photo-1506157786151-b8491531f063?w=1200",
        images: ["https://images.unsplash.com/photo-1506157786151-b8491531f063?w=1200"],
        imageLink: ""
      }
    ]
  };

  await pool.query(
    'UPDATE public."schools" SET content = $1 WHERE code = \'GBU\';',
    [JSON.stringify(gbuContent)]
  );

  console.log('🎉 Seeding successfully completed!');
  await pool.end();
}

main().catch(err => {
  console.error('❌ Seeding failed:', err.message);
  process.exit(1);
});
