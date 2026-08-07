'use strict';

/**
 * make-resumes.js — a varied set of real-shaped student resumes.
 *
 * Serves Phase 1 (internship routing across 3 students) and Phase 6
 * (generalization across 5 varied resumes). Years are derived from the
 * current year so the fixtures do not rot.
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const CY = new Date().getFullYear();
const OUT = path.resolve(__dirname, '..', 'test-resumes');
fs.mkdirSync(OUT, { recursive: true });

const RESUMES = {
  // 1. Strong CS student, 2nd year, clear location
  'student-strong-2nd-year.pdf': `Aarav Sharma
Frontend / Full Stack Developer | 2nd Year B.Tech (Computer Science)
Hyderabad, Telangana, India
aarav.sharma.dev@example.com | github.com/aaravsharma

Professional Summary
Second-year Computer Science student building production web applications.

Technical Skills
Languages: JavaScript, TypeScript, Python, SQL, C++, HTML5, CSS3
Frontend: React, Next.js, Tailwind CSS, Redux Toolkit
Backend: Node.js, Express.js, REST APIs, JWT Authentication
Databases: PostgreSQL, MongoDB, Redis
Tools: Git, Docker, Postman, Vercel

Education
B.Tech - Computer Science & Engineering (${CY - 1}-${CY + 3})
XYZ Institute of Technology, Hyderabad, Telangana
CGPA: 9.28/10

Experience
Frontend Developer (Part-time) - Acme Digital, Hyderabad
Built React interfaces for a customer analytics dashboard.

Projects
DevConnect - Developer community platform. Next.js, Node.js, PostgreSQL.
TaskFlow - Kanban tool. React, Redux Toolkit, Express, MongoDB.

Achievements
Winner, XYZ Institute Hackathon ${CY - 1}
`,

  // 2. Strong CS student, final year
  'student-final-year.pdf': `Priya Nair
Backend Engineer | Final Year B.Tech (Computer Science)
Bengaluru, Karnataka, India
priya.nair.dev@example.com | github.com/priyanair

Professional Summary
Final-year Computer Science student focused on distributed backend systems.

Technical Skills
Languages: Java, Python, Go, SQL
Backend: Spring Boot, FastAPI, gRPC, REST APIs
Databases: PostgreSQL, Cassandra, Redis
Infrastructure: Docker, Kubernetes, AWS, Kafka

Education
B.Tech - Computer Science & Engineering (${CY - 3}-${CY + 1})
National Institute of Technology, Bengaluru, Karnataka
CGPA: 8.9/10

Experience
Backend Intern - Fintech Startup, Bengaluru
Built payment reconciliation services in Java and Spring Boot.

Projects
StreamAgg - Kafka-based event aggregation pipeline. Go, Kafka, PostgreSQL.
ShortLink - Distributed URL shortener. Java, Redis, Docker.
`,

  // 3. Thin resume — few skills, no experience, no projects (tests weak-resume path)
  'student-thin.pdf': `Rahul Verma
B.Sc Student
Pune, Maharashtra, India
rahul.verma@example.com

Education
B.Sc - Information Technology (${CY - 1}-${CY + 2})
Pune University, Pune, Maharashtra

Skills
HTML, CSS

Interests
Computers, Cricket
`,

  // 4. No location anywhere (tests geography fallback)
  'student-no-location.pdf': `Sneha Iyer
Data Science Student
sneha.iyer.ds@example.com | github.com/snehaiyer

Professional Summary
Third-year student specialising in machine learning and data analysis.

Technical Skills
Languages: Python, R, SQL
ML: scikit-learn, pandas, NumPy, TensorFlow, PyTorch
Visualization: Matplotlib, Seaborn, Tableau

Education
B.Tech - Data Science (${CY - 2}-${CY + 2})
CGPA: 9.1/10

Projects
ChurnPredict - Customer churn model. Python, scikit-learn, pandas.
VisionSort - Image classifier. PyTorch, TensorFlow.
`,

  // 5. Non-CS field, unusual formatting (all caps headers, dense)
  'student-non-cs.pdf': `MEERA KRISHNAN
MECHANICAL ENGINEERING STUDENT | CHENNAI, TAMIL NADU, INDIA
meera.k.mech@example.com

EDUCATION
B.E MECHANICAL ENGINEERING (${CY - 2}-${CY + 2})
ANNA UNIVERSITY, CHENNAI, TAMIL NADU | CGPA 8.4/10

TECHNICAL SKILLS
CAD: SolidWorks, AutoCAD, CATIA
ANALYSIS: ANSYS, MATLAB, Simulink
MANUFACTURING: CNC Programming, GD&T, Lean Manufacturing
OTHER: Python, Excel

PROJECTS
THERMAL ANALYSIS OF EV BATTERY PACK - ANSYS, SolidWorks
AUTOMATED CONVEYOR SORTING SYSTEM - Arduino, Python

CERTIFICATIONS
SolidWorks Associate (CSWA)
Six Sigma Green Belt
`,
};

for (const [file, text] of Object.entries(RESUMES)) {
  const doc = new PDFDocument();
  const target = path.join(OUT, file);
  doc.pipe(fs.createWriteStream(target));
  doc.fontSize(10).text(text, { align: 'left' });
  doc.end();
  const gradMatch = text.match(/\((\d{4})-(\d{4})\)/);
  console.log(`  ${file.padEnd(30)} grad ${gradMatch ? gradMatch[2] : '?'}`);
}

console.log(`\nWritten to ${OUT} (current year ${CY})`);
