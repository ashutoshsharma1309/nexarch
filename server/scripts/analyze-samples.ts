/**
 * Prints the analyzer's JSON output for a spread of sample prompts.
 * Run from server/:  npx tsx scripts/analyze-samples.ts
 * Useful for eyeballing spec quality after lexicon or knowledge-base edits.
 */
import { analyzeRequirements } from '../src/modules/analysis/analysis.service.js';

const SAMPLE_PROMPTS: readonly string[] = [
  'Build a Hospital System',
  'Build a hospital management system where patients book appointments with doctors, with billing, prescriptions and sms reminders',
  'Build an E-Commerce Website with JWT authentication, Admin Dashboard, Product Management and Order Tracking',
  'Build a school ERP with attendance, exams, timetable and parent sms alerts',
  'CRM for the sales team with leads pipeline, tasks and email integration',
  'Portfolio Website for a freelance designer',
  'Build a chat app with socket.io, group chats and file sharing',
  'Inventory management system with low stock alerts, suppliers and excel export',
  'Restaurant POS with menu management, table billing and a kitchen display',
  'Hotel room booking website with online payments and email confirmations',
  'Build an lms called SkillForge with paid video courses, quizzes and certificates',
  'Banking system with accounts, transfers, otp login and transaction sms alerts',
];

for (const prompt of SAMPLE_PROMPTS) {
  process.stdout.write(`\n━━━ PROMPT ━━━\n${prompt}\n`);
  process.stdout.write(`${JSON.stringify(analyzeRequirements(prompt), null, 2)}\n`);
}
