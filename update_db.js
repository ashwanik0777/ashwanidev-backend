const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_gmyJkt3c4xDh@ep-steep-art-a10yu9l2-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&uselibpqcompat=true'
});
const fs = require('fs');
const data = [
  {
    "id": "SOVS-F0035",
    "facultyName": "Dr. Vinit Kumar",
    "filename": "Dr. Vinit Kumar.png",
    "path": "/assets/Faculty/Dr. Vinit Kumar.png"
  },
  {
    "id": "SOL-F0016",
    "facultyName": "Sh. R. B. Sharma",
    "filename": "Sh. R. B. Sharma.jpg",
    "path": "/assets/Faculty/Sh. R. B. Sharma.jpg"
  },
  {
    "id": "SOBT-F0022",
    "facultyName": "Prof. Umesh Chand Singh Yadav",
    "filename": "Prof. Umesh Chand Singh Yadav.jpeg",
    "path": "/assets/Faculty/Prof. Umesh Chand Singh Yadav.jpeg"
  },
  {
    "id": "SOL-F0015",
    "facultyName": "Prof. Uday Shankar",
    "filename": "Prof. Uday Shankar.jpg",
    "path": "/assets/Faculty/Prof. Uday Shankar.jpg"
  },
  {
    "id": "SOVS-F0033",
    "facultyName": "Prof. Saumitra Mukherjee",
    "filename": "Prof. Saumitra Mukherjee.jpg",
    "path": "/assets/Faculty/Prof. Saumitra Mukherjee.jpg"
  },
  {
    "id": "SOICT-F0015",
    "facultyName": "Prof. Sanjay Kumar Sharma",
    "filename": "Prof. Sanjay Kumar Sharma.jpg",
    "path": "/assets/Faculty/Prof. Sanjay Kumar Sharma.jpg"
  },
  {
    "id": "SOE-F0013",
    "facultyName": "Prof. S.P. Singh",
    "filename": "Prof. S.P. Singh.jpg",
    "path": "/assets/Faculty/Prof. S.P. Singh.jpg"
  },
  {
    "id": "SOBT-F0029",
    "facultyName": "Prof. S Dhanalakshmi",
    "filename": "Prof. S Dhanalakshmi.png",
    "path": "/assets/Faculty/Prof. S Dhanalakshmi.png"
  },
  {
    "id": "SOBT-F0028",
    "facultyName": "Prof. Rajeev Varshney",
    "filename": "Prof. Rajeev Varshney.jpg",
    "path": "/assets/Faculty/Prof. Rajeev Varshney.jpg"
  },
  {
    "id": "SOHSS-F0037",
    "facultyName": "Prof. Madhav Govind",
    "filename": "Prof. Madhav Govind.jpg",
    "path": "/assets/Faculty/Prof. Madhav Govind.jpg"
  },
  {
    "id": "SOBT-F0013",
    "facultyName": "Prof. Dr. Sudhir Kumar Shukla",
    "filename": "Prof. Dr. Sudhir Kumar Shukla.jpg",
    "path": "/assets/Faculty/Prof. Dr. Sudhir Kumar Shukla.jpg"
  },
  {
    "id": "SOVS-F0034",
    "facultyName": "Prof. Chander Kumar Singh",
    "filename": "Prof. Chander Kumar Singh.jpeg",
    "path": "/assets/Faculty/Prof. Chander Kumar Singh.jpeg"
  },
  {
    "id": "SOHSS-F0017",
    "facultyName": "Prof. Bandana Pandey",
    "filename": "Prof. Bandana Pandey.jpg",
    "path": "/assets/Faculty/Prof. Bandana Pandey.jpg"
  },
  {
    "id": "SOBT-F0026",
    "facultyName": "Prof. B.R. Panda",
    "filename": "Prof. B.R. Panda.jpg",
    "path": "/assets/Faculty/Prof. B.R. Panda.jpg"
  },
  {
    "id": "SOL-F0013",
    "facultyName": "Prof. A. Lakshminath",
    "filename": "Prof. A. Lakshminath.png",
    "path": "/assets/Faculty/Prof. A. Lakshminath.png"
  },
  {
    "id": "SOL-F0014",
    "facultyName": "Hon'ble. Mr. Justice Pradeep Kumar",
    "filename": "Hon'ble. Mr. Justice Pradeep Kumar.jpg",
    "path": "/assets/Faculty/Hon'ble. Mr. Justice Pradeep Kumar.jpg"
  },
  {
    "id": "SOL-F0018",
    "facultyName": "Hon'ble Mr. Justice Ravi Shankar Jha",
    "filename": "Hon'ble Mr. Justice Ravi Shankar Jha.png",
    "path": "/assets/Faculty/Hon'ble Mr. Justice Ravi Shankar Jha.png"
  },
  {
    "id": "SOBT-F0024",
    "facultyName": "Dr. Shivani Ghildiyal",
    "filename": "Dr. Shivani Ghildiyal.png",
    "path": "/assets/Faculty/Dr. Shivani Ghildiyal.png"
  },
  {
    "id": "SOBT-F0025",
    "facultyName": "Dr. Shalini Rai",
    "filename": "Dr. Shalini Rai.jpg",
    "path": "/assets/Faculty/Dr. Shalini Rai.jpg"
  },
  {
    "id": "SOBT-F0023",
    "facultyName": "Dr. Pramod R. Yadav",
    "filename": "Dr. Pramod R. Yadav.jpg",
    "path": "/assets/Faculty/Dr. Pramod R. Yadav.jpg"
  },
  {
    "id": "SOBT-F0027",
    "facultyName": "Dr. Prafullakumar B. Tailor",
    "filename": "Dr. Prafullakumar B. Tailor.jpeg",
    "path": "/assets/Faculty/Dr. Prafullakumar B. Tailor.jpeg"
  }
];

async function update() {
  for (const item of data) {
    const res = await pool.query('UPDATE faculty_profiles SET image_url = $1 WHERE id = $2', [item.path, item.id]);
    console.log(`Updated ${item.id}: ${res.rowCount} rows`);
  }
  pool.end();
}
update();
