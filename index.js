'use strict';

/* ============================== SETTINGS ==============================
 * Edit only this block.
 * DEFAULT_LANGUAGE : "auto" | "en" | "ur" | "roman"
 * REPLY_MODE       : "AUTO" (replies on) | "OFF" (starts paused, send RESUME to enable)
 * CUSTOM_GREETING  : if not empty, used instead of the normal Hi/Hello reply
 *                    (placeholders: {OWNER} {BOT})
 * CUSTOM_RULES     : one rule per line, format:  trigger words => reply text
 *                    example: "office kab aana => Kal subah 10 baje\nwifi password => Mujhse direct poochh lein"
 * OWNER_NUMBER     : the number that may send HELP / STATUS / PAUSE / RESUME / LANGUAGE ...
 *                    (must be a DIFFERENT number from the bot account)
 * ====================================================================== */
const SETTINGS = {
  BOT_NAME:  "Jibran Assistant",
  BOT_WHATSAPP_NUMBER: "03704295530",
  OWNER_NAME: "Jibran",
  DEFAULT_LANGUAGE: "auto",
  REPLY_MODE: "AUTO",
  ENABLE_GROUP_MESSAGES: false,
  ENABLE_STATUS_MESSAGES: false,
  OWNER_NUMBER: "03704295530,
  CUSTOM_GREETING: "",
  CUSTOM_RULES: "",
};
/* ===================================================================== */

const fs = require('fs');
const path = require('path');
const pino = require('pino');
const qrcode = require('qrcode-terminal');

const SESSION_DIR = 'session_bot';
const STATE_FILE = path.join(SESSION_DIR, 'bot_state.json');
const CONFIG = {
  RECONNECT_DELAY_MS: 4000,
  MAX_MESSAGE_AGE_S: 180,            // ignore old offline backlog
  GREET_COOLDOWN_MS: 15 * 60 * 1000,
  MEDIA_NOTICE_COOLDOWN_MS: 30 * 60 * 1000,
  SILENT_REPEAT_MS: 10 * 60 * 1000,
  MAX_REPLIES_PER_MIN: 6,            // loop protection per chat
  MAX_SEEN_IDS: 5000,
  CHAT_IDLE_MS: 24 * 60 * 60 * 1000,
};

const STARTED_AT = Date.now();
const log = (...a) => console.log(new Date().toISOString(), '|', ...a);
const warn = (...a) => console.warn(new Date().toISOString(), '| WARN |', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ----------------------------- phone helpers ----------------------------- */
function toIntl(num) {
  let d = String(num || '').replace(/\D/g, '');
  if (d.startsWith('0092')) d = d.slice(2);
  if (d.startsWith('92') && d.length === 12) return d;
  if (d.startsWith('0') && d.length === 11) return '92' + d.slice(1);
  if (d.length === 10 && d.startsWith('3')) return '92' + d;
  if (d.length >= 11 && d.length <= 15 && !d.startsWith('0')) return d;
  return '';
}
const BOT_INTL = toIntl(SETTINGS.BOT_WHATSAPP_NUMBER);
const OWNER_INTL = toIntl(SETTINGS.OWNER_NUMBER);
const jidUser = (jid) => String(jid || '').split('@')[0].split(':')[0];
const maskNum = (n) => (n ? '***' + String(n).slice(-3) : 'unknown');
function numberFromJids(list) {
  for (const j of list) {
    if (j && String(j).endsWith('@s.whatsapp.net')) return jidUser(j);
  }
  return '';
}

/* ------------------------------ bot state ------------------------------ */
let botState = { paused: false, language: null }; // language: null | auto | en | ur | roman
function normalizeLang(v) {
  const s = String(v || 'auto').toLowerCase().trim();
  if (['en', 'english'].includes(s)) return 'en';
  if (['ur', 'urdu'].includes(s)) return 'ur';
  if (['roman', 'roman urdu', 'ru'].includes(s)) return 'roman';
  return 'auto';
}
function loadBotState() {
  botState = { paused: false, language: null };
  try {
    if (fs.existsSync(STATE_FILE)) {
      const j = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      botState.paused = !!j.paused;
      botState.language = ['en', 'ur', 'roman', 'auto'].includes(j.language) ? j.language : null;
    }
  } catch (e) { warn('Could not read bot_state.json:', e.message); }
  if (String(SETTINGS.REPLY_MODE).toUpperCase() === 'OFF') botState.paused = true;
}
function saveBotState() {
  try {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(botState));
  } catch (e) { warn('Could not save bot_state.json:', e.message); }
}
function resolveLang(detected) {
  const forced = botState.language !== null ? botState.language : normalizeLang(SETTINGS.DEFAULT_LANGUAGE);
  return forced !== 'auto' ? forced : detected;
}

/* ------------------------------ text helpers ------------------------------ */
function normalize(s) {
  return String(s || '').toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[هۃ]/g, 'ہ')
    .replace(/(.)\1{2,}/gu, '$1$1')
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ').trim();
}
const startsWithAny = (norm, list) => list.some((p) => norm === p || norm.startsWith(p + ' '));
const fill = (t) => String(t).replace(/\{OWNER\}/g, SETTINGS.OWNER_NAME).replace(/\{BOT\}/g, SETTINGS.BOT_NAME);

/* ------------------------------ language detection ------------------------------ */
const ROMAN_WORDS = new Set(['kya','kia','haal','hal','hain','hai','hein','ho','hon','hun','hoon','kahan','kidhar','aap','tum','tm','main','mein','mai','mujhe','mera','meri','tera','tumhara','aapka','apna','apka','aur','sunao','sunayein','sunaye','sunain','batao','batayein','theek','thik','shukriya','shukria','mehrbani','khana','kha','liya','lia','kar','kr','rahay','rahe','raha','rhe','rha','rahi','nahi','nahin','haan','han','ji','jee','acha','accha','achha','kaisay','kaise','kese','kaisa','kaisi','kab','kyun','kyu','kaun','kon','bhai','yaar','yar','bilkul','maaf','maafi','chalo','phir','kal','aaj','abhi','bas','sab','kuch','naya','wala','wali','karo','karna','bohat','bahut','zabardast','khayal','rakhiye','rakhna','subah','shaam','raat','bakhair']);
const EN_WORDS = new Set(['the','is','are','you','your','what','how','where','when','why','who','doing','good','morning','afternoon','evening','night','thanks','thank','please','sorry','hello','hi','hey','fine','i','am','im','me','my','it','this','that','can','do','have','will','would','could','not','no','yes','today','tomorrow','later','bye','take','care','up','whats','about','and','to','of','in','for','with','at','on','be','was','were','free','busy','here','there','just','nothing','much','going','been','welcome','great','nice','sure','right','a']);
const ISLAMIC_HINT = /(assalam|salam|alaikum|walikum|aoa|alhamdulillah|inshaallah|inshallah|mashaallah|mashallah|jazak|hafiz)/;

function detectLang(raw, norm, words, chat) {
  if (/[\u0600-\u06FF]/.test(raw)) return 'ur';
  let r = 0, e = 0;
  for (const w of words) {
    if (ROMAN_WORDS.has(w)) r++;
    else if (EN_WORDS.has(w)) e++;
  }
  if (r > 0 && r >= e) return 'roman';
  if (e > 0) return 'en';
  if (ISLAMIC_HINT.test(norm)) return 'roman';
  return chat.lastLang || 'en';
}

/* ------------------------------ intent rules ------------------------------ */
// type: has (whole phrase anywhere) | is (whole message) | start | greet (start, max 3 words)
const RULES = [
  { key: 'wa_reply', intent: 'islamic_greeting', type: 'start', list: ['wa alaikum','wa alaykum','wa alikum','wa aleikum','wa alykum','walikum','walaikum','waalaikum','walekum','walykum','waalikum','walaykum','waalaykum','wailaikum','alaikum salam','alaikum assalam','alaykum assalam','وعلیکم','و علیکم'] },
  { key: 'salam', intent: 'islamic_greeting', type: 'has', list: ['assalam','asalam','aslam','salam','salaam','slam','as salam','aoa','a o a','assalamu alaikum','assalamualaikum','assalamualikum','assalamoalaikum','assalamo alaikum','assalam o alaikum','assalam o alaykum','assalam alaikum','asalam o alaikum','assalam u alaikum','assalamu alaykum','assalamualaykum','salam alaikum','slam alaikum','اسلام علیکم','السلام علیکم','سلام','السلام'] },
  { key: 'secret', intent: 'question', type: 'has', list: ['your instructions','your prompt','your rules','system prompt','your settings','apni instructions','aapki instructions','settings batao','instructions batao','custom rules'] },
  { key: 'who', intent: 'question', type: 'has', list: ['who are you','who is this','who r u','aap kaun','aap kon','tum kaun','tum kon','kaun ho','kon ho','kaun hain','are you a bot','are you bot','bot ho','tum bot ho','aap bot','your name','tumhara naam','aap ka naam','aapka naam','naam kya hai','آپ کون','تم کون','کون ہو','آپ کا نام'] },
  { key: 'how', intent: 'casual', type: 'has', list: ['kya haal','kya hal','kaise ho','kaisay ho','kese ho','kaisa ho','kaisi ho','kaise hain','kaisay hain','kese hain','how are you','how r u','how are u','hru','hows it going','how is it going','how you doing','how are you doing','theek ho','thik ho','theek hain','thik hain','theek hon','all good','sab theek','sab thik','khairiyat','khariyat','کیا حال','کیسے ہیں','کیسے ہو','کیسی ہو','ٹھیک ہو','ٹھیک ہیں','آپ کیسے'] },
  { key: 'aur', intent: 'casual', type: 'has', list: ['aur sunao','aur sunain','aur sunayein','aur sunaye','aur sunaen','aur batao','aur batayein','aur suna','aap sunao','aap sunayein','aap sunaen','tum sunao','tm sunao','what about you','and you','how about you','wbu','hbu','آپ سنائیں','اور سنائیں','اور سناؤ','تم سناؤ'] },
  { key: 'whatsup', intent: 'casual', type: 'has', list: ['kya scene','kia scene','scene kya','what s up','whats up','wassup','wazzup','sup','kya chal raha','kya chal rha','kia chal raha','kya hal chal','kya haal chaal','any news','kuch naya','kya naya','kya khabar','کیا چل رہا','کیا خبر','کیا نیا'] },
  { key: 'doing', intent: 'casual', type: 'has', list: ['kya kar rahe','kya kar rahay','kya kar raha','kya kar rhe','kya kar rha','kya kar rahi','kya kr rhe','kya kr raha','kya kr rahe','kia kar rahe','kia kar rahay','kia kr rahe','what are you doing','what r u doing','what are u doing','what you doing','wyd','what are you up to','what you up to','whatcha doing','kya ho raha','کیا کر رہے','کیا کر رہی','کیا کر رہا'] },
  { key: 'where', intent: 'casual', type: 'has', list: ['kahan ho','kahaan ho','kidhar ho','kahan hain','where are you','where r u','where are u','wru','کہاں ہو','کہاں ہیں'] },
  { key: 'eaten', intent: 'casual', type: 'has', list: ['khana kha liya','khana kha lia','khana khaya','khana khaliya','khana kha li','lunch kiya','lunch kar liya','dinner kiya','dinner kar liya','nashta kiya','nashta kar liya','have you eaten','did you eat','have you had lunch','have you had dinner','کھانا کھا لیا','کھانا کھایا'] },
  { key: 'busy', intent: 'casual', type: 'has', list: ['busy ho','busy hain','busy hein','are you busy','r u busy','free ho','free hain','are you free','r u free','فری ہو','فارغ ہو','مصروف ہو','مصروف ہیں'] },
  { key: 'rude', intent: 'unknown', type: 'has', list: ['idiot','stupid','bewakoof','bewaqoof','kamina','harami','fuck you','shut up','بیوقوف'] },
  { key: 'jazak', intent: 'thanks', type: 'has', list: ['jazakallah','jazak allah','jazakillah','jazaakallah','jazaak allah','jazak','جزاک اللہ','جزاکاللہ'] },
  { key: 'hamd', intent: 'casual', type: 'has', list: ['alhamdulillah','alhamdulilah','alhamdullilah','al hamdulillah','alhmdulillah','الحمدللہ','الحمد للہ'] },
  { key: 'insha', intent: 'casual', type: 'has', list: ['inshallah','inshaallah','insha allah','in sha allah','inshaa allah','inshalla','inshaalah','ان شاء اللہ','انشاءاللہ','انشاء اللہ'] },
  { key: 'masha', intent: 'casual', type: 'has', list: ['mashallah','mashaallah','masha allah','ma sha allah','mashaalah','ماشاءاللہ','ماشاء اللہ'] },
  { key: 'ameen', intent: 'casual', type: 'has', list: ['ameen','aameen','amin','آمین'] },
  { key: 'thanks', intent: 'thanks', type: 'has', list: ['thanks','thank you','thankyou','thanx','thx','tysm','ty','shukriya','shukria','shukriyah','mehrbani','meherbani','mehrbaani','many thanks','شکریہ','مہربانی','شکریا'] },
  { key: 'sorry', intent: 'apology', type: 'has', list: ['sorry','sry','soory','maaf','maafi','mazrat','my bad','apologies','afsos','معذرت','معافی','معاف'] },
  { key: 'bye', intent: 'goodbye', type: 'has', list: ['allah hafiz','allahhafiz','allah hafez','khuda hafiz','khudahafiz','khuda hafez','bye','byee','bye bye','goodbye','good bye','see you','see ya','see you later','talk later','ttyl','chalo phir','phir milte hain','phir baat hogi','اللہ حافظ','خدا حافظ'] },
  { key: 'takecare', intent: 'goodbye', type: 'has', list: ['take care','takecare','apna khayal rakhna','apna khayal rakhiye','khayal rakhna','khayal rakhiye','tc','اپنا خیال رکھنا','اپنا خیال رکھیے'] },
  { key: 'night', intent: 'goodbye', type: 'has', list: ['good night','goodnight','gn','shab bakhair','shab bakheir','raat bakhair','شب بخیر','good nite'] },
  { key: 'morning', intent: 'greeting', type: 'has', list: ['good morning','gm','subah bakhair','subha bakhair','subah bakheir','صبح بخیر','morning','gud morning'] },
  { key: 'afternoon', intent: 'greeting', type: 'has', list: ['good afternoon','dopahar bakhair','دوپہر بخیر','afternoon'] },
  { key: 'evening', intent: 'greeting', type: 'has', list: ['good evening','shaam bakhair','sham bakhair','شام بخیر','evening'] },
  { key: 'fine', intent: 'casual', type: 'has', list: ['main theek','mai theek','mein theek','theek hun','thik hun','theek hoon','main bhi theek','mai bhi theek','i m fine','i am fine','im fine','i m good','i am good','im good','doing good','doing well','fine thanks','good thanks'] },
  { key: 'agree', intent: 'agreement', type: 'is', list: ['ok','okay','okk','okie','k','kk','acha','accha','achha','acha ji','accha ji','achha ji','theek hai','thik hai','theek hai ji','thik hai ji','theek','thik','hmm','hm','hmmm','sure','yes','yeah','yep','yup','haan','han','hn','haa','jee','ji','g','ji haan','ji han','ji theek hai','jee theek hai','bilkul','right','alright','all right','got it','fine','cool','nice','great','zabardast','perfect','done','ok done','okay done','ok g','ok ji','okay ji','ok bhai','ok yaar','اچھا','ٹھیک ہے','جی','ہاں','جی ہاں','جی ٹھیک ہے','بالکل'] },
  { key: 'greeting', intent: 'greeting', type: 'greet', list: ['hi','hii','hello','helo','hellow','helloo','hey','heyy','hy','hyy','yo','hola','oye','hullo','hi there','hey there','hello there','ہیلو','ہائے'] },
];
const QUESTION_STARTS = ['what','why','how','when','where','who','which','can you','could you','do you','are you','is it','will you','would you','kya','kia','kyun','kyu','kab','kaun','kon','kaise','kese','kaisay','kitna','kitne','kitni','kahan','کیا','کیوں','کب','کون','کیسے','کتنا','کہاں'];

function matchRule(rule, norm, words) {
  switch (rule.type) {
    case 'is': return rule.list.includes(norm);
    case 'start': return startsWithAny(norm, rule.list);
    case 'greet': return words.length <= 3 && startsWithAny(norm, rule.list);
    default: {
      const padded = ' ' + norm + ' ';
      return rule.list.some((p) => padded.includes(' ' + p + ' '));
    }
  }
}
function classify(raw, norm, words) {
  for (const r of RULES) if (matchRule(r, norm, words)) return { key: r.key, intent: r.intent };
  if (/[?؟]/.test(raw) || startsWithAny(norm, QUESTION_STARTS)) return { key: 'question', intent: 'question' };
  if (words.length >= 3) return { key: 'general', intent: 'general' };
  return { key: 'unknown', intent: 'unknown' };
}

/* ------------------------------ reply banks ------------------------------ */
const L = (en, roman, ur) => ({ en, roman, ur });
const REPLIES = {
  salam: L(
    ['Wa Alaikum Assalam! 😊 How are you?', "Wa Alaikum Assalam! Hope you're doing well 😊", 'Wa Alaikum Assalam wa Rahmatullah! 😊'],
    ['Wa Alaikum Assalam! 😊 Kya haal hain?', 'Wa Alaikum Assalam wa Rahmatullah! Aap kaisay hain? 😊', 'Wa Alaikum Assalam! Umeed hai aap khairiyat se hain 😊', 'Wa Alaikum Assalam! Boliye, kaisay hain aap?'],
    ['وعلیکم السلام! 😊 کیا حال ہیں؟', 'وعلیکم السلام و رحمۃ اللہ! 😊 آپ کیسے ہیں؟', 'وعلیکم السلام! امید ہے آپ خیریت سے ہیں 😊']),
  wa_reply: L(
    ['Alhamdulillah 😊 How have you been?', "Thank you! 😊 What's up?"],
    ['Ji 😊 Boliye, kya haal hain?', 'Shukriya! 😊 Aur sunayein?'],
    ['جی 😊 فرمائیے، کیا حال ہیں؟', 'شکریہ! 😊 اور سنائیں؟']),
  greeting: L(
    ['Hey! 😊 How are you?', "Hi there! 😊 How's it going?", "Hello! 😊 What's up?"],
    ['Hello! 😊 Kya haal hain?', 'Hi! Kaisay hain aap? 😊', 'Hey! 😊 Kya chal raha hai?'],
    ['ہیلو! 😊 کیا حال ہیں؟', 'ہائے! آپ کیسے ہیں؟ 😊', 'ہیلو! 😊 کیا چل رہا ہے؟']),
  greet_again: L(
    ["I'm here 😊 What's up?", 'Yes, go ahead 😊', 'Hey again! 😊'],
    ['Ji, boliye 😊', 'Haan ji, boliye 😊', 'Ji farmaiye 😊'],
    ['جی، فرمائیے 😊', 'جی، بتائیے 😊', 'جی، میں یہیں ہوں 😊']),
  morning: L(
    ['Good morning! ☀️ Have a wonderful day.', 'Good morning! 😊 Wishing you a great day ahead.', 'Morning! ☀️ Hope you slept well.'],
    ['Good morning! ☀️ Aap ka din bohat acha guzray.', 'Subah bakhair! 😊 Umeed hai aap ka din acha guzray ga.', 'Good morning! ☀️ Raat kaisi guzri?'],
    ['صبح بخیر! ☀️ آپ کا دن بہت اچھا گزرے۔', 'صبح بخیر! 😊 اللہ آپ کا دن خوشگوار بنائے۔']),
  afternoon: L(
    ['Good afternoon! 😊 Hope your day is going well.', "Good afternoon! ☀️ How's your day so far?"],
    ['Good afternoon! 😊 Din kaisa guzar raha hai?', 'Good afternoon! ☀️ Umeed hai sab acha ja raha hai.'],
    ['دوپہر بخیر! 😊 آپ کا دن کیسا گزر رہا ہے؟', 'دوپہر بخیر! ☀️ امید ہے سب اچھا جا رہا ہے۔']),
  evening: L(
    ['Good evening! 🌆 Hope you had a nice day.', 'Good evening! 😊 How was your day?'],
    ['Good evening! 🌆 Din kaisa guzra?', 'Shaam bakhair! 😊 Umeed hai din acha guzra.'],
    ['شام بخیر! 🌆 آپ کا دن کیسا گزرا؟', 'شام بخیر! 😊 امید ہے دن اچھا گزرا۔']),
  night: L(
    ['Good night! 🌙 Sleep well.', 'Good night! Sweet dreams 😊'],
    ['Good night! 🌙 Allah Hafiz, acha araam karein.', 'Shab bakhair! 😊 Apna khayal rakhiye ga.'],
    ['شب بخیر! 🌙 اللہ حافظ۔', 'شب بخیر! 😊 اپنا خیال رکھیے گا۔']),
  how: L(
    ["I'm doing well, thanks! How about you? 😊", 'All good here! How are you doing?', 'Doing great, thank you! What about you? 😊'],
    ['Alhamdulillah, sab theek hai! Aap sunayein? 😊', 'Bilkul theek! Aap batayein, kya chal raha hai? 😊', 'Mehrbani, sab acha hai. Aap kaisay hain?'],
    ['الحمدللہ، سب ٹھیک ہے! آپ سنائیں؟ 😊', 'بالکل ٹھیک! آپ کیسے ہیں؟', 'شکریہ، سب اچھا ہے۔ آپ کا کیا حال ہے؟ 😊']),
  aur: L(
    ['Just here and ready to chat! 😊 What about you?', 'All good on my side 😊 Tell me about your day.'],
    ['Bas sab theek, aap batayein 😊 Aap ka din kaisa ja raha hai?', 'Yahan sab acha hai 😊 Aap sunayein, kya chal raha hai?'],
    ['بس سب ٹھیک ہے 😊 آپ بتائیں، آپ کا دن کیسا ہے؟', 'یہاں سب اچھا ہے 😊 آپ سنائیں، کیا چل رہا ہے؟']),
  whatsup: L(
    ['Not much, just chatting 😊 What\'s up with you?', "All good here! What's new with you?"],
    ['Bas sab theek chal raha hai 😊 Aap sunayein, kya scene hai?', 'Kuch khaas nahi 😊 Aap batayein, kya chal raha hai?'],
    ['بس سب ٹھیک چل رہا ہے 😊 آپ سنائیں؟', 'کچھ خاص نہیں 😊 آپ بتائیں، کیا نیا ہے؟']),
  doing: L(
    ['Just here and ready to chat! 😊', 'Just chatting with you right now 😊 What about you?', 'Nothing much, just here to chat! What are you up to?'],
    ['Bas aap se baat ho rahi hai 😊 Aap sunayein?', 'Kuch khaas nahi, yahin hun 😊 Aap kya kar rahay hain?'],
    ['بس آپ سے بات ہو رہی ہے 😊 آپ سنائیں؟', 'کچھ خاص نہیں، یہیں ہوں 😊 آپ کیا کر رہے ہیں؟']),
  where: L(
    ["I'm right here in this chat 😊 Where are you?", 'Just here on WhatsApp 😊 How about you?'],
    ['Main yahin WhatsApp par hun 😊 Aap kahan hain?', 'Bas yahin chat mein hun 😊 Aap sunayein?'],
    ['میں یہیں واٹس ایپ پر ہوں 😊 آپ کہاں ہیں؟', 'بس یہیں چیٹ میں ہوں 😊 آپ سنائیں؟']),
  eaten: L(
    ["I don't eat, but thanks for asking! 😄 Did you have your meal?", 'No meals for me 😄 What about you, have you eaten?'],
    ['Mera khana peena nahi hota 😄 Aap ne kha liya?', 'Poochne ka shukriya 😊 Mujhe khane ki zaroorat nahi, aap ne kha liya?'],
    ['میرا کھانا پینا نہیں ہوتا 😄 آپ نے کھا لیا؟', 'پوچھنے کا شکریہ 😊 مجھے کھانے کی ضرورت نہیں، آپ نے کھا لیا؟']),
  busy: L(
    ["Not busy right now 😊 What's up?", "I'm available to chat 😊 Go ahead."],
    ['Abhi busy nahi hun 😊 Boliye.', 'Baat kar sakte hain 😊 Boliye, kya baat hai?'],
    ['ابھی مصروف نہیں ہوں 😊 فرمائیے۔', 'بات کر سکتے ہیں 😊 بتائیے کیا بات ہے؟']),
  fine: L(
    ['Glad to hear that! 😊', 'Great to hear! 😊 Anything on your mind?'],
    ['Yeh sun kar acha laga! 😊', 'Alhamdulillah, acha hai 😊'],
    ['یہ سن کر اچھا لگا! 😊', 'الحمدللہ، یہ اچھی بات ہے 😊']),
  hamd: L(
    ['Alhamdulillah! 😊 Glad to hear that.', "Alhamdulillah, that's good to hear! 🤲"],
    ['Alhamdulillah! 😊 Allah hamesha khush rakhe.', 'Shukar hai Allah ka! 🤲 Sab acha rahe.'],
    ['الحمدللہ! 😊 اللہ آپ کو ہمیشہ خوش رکھے۔', 'اللہ کا شکر ہے! 🤲']),
  insha: L(['InshaAllah! 😊', 'Ameen, InshaAllah 🤲'], ['InshaAllah! 😊 Allah behtar karey.', 'Ji InshaAllah 🤲'], ['ان شاء اللہ! 😊', 'جی، ان شاء اللہ 🤲']),
  masha: L(["MashaAllah! 😊 That's wonderful.", 'MashaAllah, great to hear! ✨'], ['MashaAllah! 😊 Bohat khoob.', 'MashaAllah, bohat acha! ✨'], ['ماشاءاللہ! 😊 بہت خوب۔', 'ماشاءاللہ، بہت اچھا! ✨']),
  ameen: L(['Ameen! 🤲', 'Ameen, Summa Ameen 🤲'], ['Ameen! 🤲', 'Ameen Summa Ameen 🤲'], ['آمین! 🤲', 'آمین ثم آمین 🤲']),
  jazak: L(["Wa iyyakum! 😊 You're most welcome.", 'JazakAllah Khair to you too! 🤲'], ['Wa iyyakum! 😊 Koi baat nahi.', 'Aap ko bhi JazakAllah Khair! 🤲'], ['وایاکم! 😊 کوئی بات نہیں۔', 'آپ کو بھی جزاک اللہ خیر! 🤲']),
  thanks: L(["You're most welcome! 😊", 'Anytime! 😊', 'No problem at all! 👍'], ['Koi baat nahi! 😊', 'Khushi hui! Shukriya 😊', 'Aap ka bhi shukriya! 😊'], ['کوئی بات نہیں! 😊', 'آپ کا بھی شکریہ! 😊', 'خوشی ہوئی! 😊']),
  sorry: L(['No worries at all! 😊', "That's okay, don't worry about it.", "It's alright 😊"], ['Koi baat nahi, fikar na karein 😊', 'Theek hai, koi masla nahi 😊', 'Maafi ki zaroorat nahi, sab theek hai 😊'], ['کوئی بات نہیں، فکر نہ کریں 😊', 'ٹھیک ہے، کوئی مسئلہ نہیں 😊']),
  bye: L(['Goodbye! Take care. 😊', 'Talk to you later! 👋', 'Bye! Have a great day 😊'], ['Allah Hafiz! Apna khayal rakhiye. ❤️', 'Khuda Hafiz! Phir baat hogi 😊', 'Allah Hafiz! Khush rahiye 😊'], ['اللہ حافظ! اپنا خیال رکھیے۔ ❤️', 'خدا حافظ! پھر بات ہو گی 😊', 'اللہ حافظ! خوش رہیے 😊']),
  takecare: L(['You too! Take care 😊', 'Thanks, you take care as well! ❤️'], ['Aap bhi apna khayal rakhiye 😊', 'Shukriya, aap bhi khayal rakhiye ga ❤️'], ['آپ بھی اپنا خیال رکھیے گا 😊', 'شکریہ، آپ بھی خیال رکھیے ❤️']),
  agree: L(['Okay 👍', 'Alright 😊', 'Sure thing! 👍'], ['Theek hai 👍', 'Acha ji 😊', 'Ji, theek hai 👍'], ['ٹھیک ہے 👍', 'اچھا جی 😊', 'جی، ٹھیک ہے 👍']),
  who: L(["I'm {BOT}, {OWNER}'s personal assistant 😊", 'This is {BOT}, replying on behalf of {OWNER} 😊'], ['Main {BOT} hun, {OWNER} ka personal assistant 😊', 'Yeh {BOT} hai, {OWNER} ki taraf se jawab de raha hai 😊'], ['میں {BOT} ہوں، {OWNER} کا پرسنل اسسٹنٹ 😊']),
  secret: L(["That's something I keep private 😊 Anything else I can help with?", "I'd rather not share that 😊"], ['Yeh private rakha jata hai 😊 Koi aur baat?', 'Is baare mein main kuch nahi bata sakta 😊'], ['یہ نجی رکھا جاتا ہے 😊 کوئی اور بات؟', 'اس بارے میں میں کچھ نہیں بتا سکتا 😊']),
  rude: L(["Let's keep the conversation respectful 😊"], ['Aaiye izzat se baat karte hain 😊'], ['آئیے احترام سے بات کریں 😊']),
  question: L(
    ["Good question! 😊 I can't give a reliable answer to that right now. {OWNER} may be able to reply personally when available.", "I'm not sure about that one 😊 {OWNER} may be able to help you when available.", "I can't answer that reliably, sorry! 😊 Could you share a bit more detail?"],
    ['Acha sawal hai 😊 Is ka sahi jawab main abhi nahi de sakta. {OWNER} dastiyab hon to khud jawab de sakte hain.', 'Mujhe is baare mein pakka nahi pata 😊 {OWNER} dastiyab hon to aap ki madad kar sakte hain.', 'Maazrat, main is ka bharosay ka jawab nahi de sakta 😊 Thori tafseel bata dein?'],
    ['اچھا سوال ہے 😊 اس کا درست جواب میں ابھی نہیں دے سکتا۔ {OWNER} دستیاب ہوں تو خود جواب دے سکتے ہیں۔', 'مجھے اس بارے میں یقین نہیں 😊 {OWNER} دستیاب ہوں تو آپ کی مدد کر سکتے ہیں۔', 'معذرت، میں اس کا قابلِ اعتماد جواب نہیں دے سکتا 😊 کچھ تفصیل بتائیں؟']),
  general: L(['I see 😊 Please tell me more.', 'Got it! Please go on 😊', 'Thanks for sharing that 😊'], ['Acha, samajh gaya 😊 Aur batayein.', 'Ji, boliye, aap batayein 😊', 'Batane ka shukriya 😊'], ['اچھا، سمجھ گیا 😊 مزید بتائیں۔', 'جی، بولیے، آپ بتائیں 😊', 'بتانے کا شکریہ 😊']),
  unknown: L(["Sorry, I didn't quite get that 😊 Could you say it differently?", "Hmm, I couldn't understand that. Could you rephrase? 🙂"], ['Maaf kijiye, samajh nahi aaya 😊 Dobara likh dein?', 'Hmm, yeh samajh nahi aaya. Thora aur wazeh karein? 🙂'], ['معذرت، سمجھ نہیں آیا 😊 دوبارہ لکھ دیں؟', 'یہ سمجھ نہیں آیا۔ ذرا وضاحت کر دیں؟ 🙂']),
  media: L(['I can only read text messages here 😊 Could you type it out?'], ['Main yahan sirf text messages parh sakta hun 😊 Barah-e-meherbani likh kar bhej dein.'], ['میں یہاں صرف ٹیکسٹ پیغامات پڑھ سکتا ہوں 😊 براہِ مہربانی لکھ کر بھیج دیں۔']),
  voice: L(["I can't play voice notes here 😊 Could you type your message?"], ['Main yahan voice notes nahi sun sakta 😊 Barah-e-meherbani likh kar bhej dein.'], ['میں یہاں وائس نوٹ نہیں سن سکتا 😊 براہِ مہربانی لکھ کر بھیج دیں۔']),
};
const SILENT_REPEAT = new Set(['agree','bye','takecare','night','thanks','hamd','insha','masha','ameen','jazak','fine','sorry']);
const GREET_KEYS = new Set(['salam','greeting','morning','afternoon','evening']);

function pickReply(chat, key, lang) {
  const bank = REPLIES[key] || REPLIES.unknown;
  const list = bank[lang] || bank.en;
  const lastReply = chat.recentReplies[chat.recentReplies.length - 1];
  let pool = list.filter((t) => !chat.recentReplies.includes(t));
  if (!pool.length) pool = list.filter((t) => t !== lastReply);
  if (!pool.length) pool = list;
  const choice = pool[Math.floor(Math.random() * pool.length)];
  chat.recentReplies.push(choice);
  if (chat.recentReplies.length > 8) chat.recentReplies.shift();
  return fill(choice);
}

/* ------------------------------ custom rules ------------------------------ */
function parseRules(str) {
  return String(str || '').split('\n')
    .map((l) => l.split('=>'))
    .filter((p) => p.length >= 2 && p[0].trim() && p.slice(1).join('=>').trim())
    .map((p) => ({ trigger: normalize(p[0]), reply: p.slice(1).join('=>').trim() }))
    .filter((r) => r.trigger);
}
const CUSTOM_RULES = parseRules(SETTINGS.CUSTOM_RULES);

/* ------------------------------ chat state ------------------------------ */
const chats = new Map();
function getChat(key) {
  let c = chats.get(key);
  if (!c) {
    c = { lastSeen: 0, count: 0, lastLang: null, lastKey: null, lastIntent: null, lastReplyAt: 0, lastGreetAt: 0, lastMediaNoticeAt: 0, recentReplies: [], history: [], replyTimes: [] };
    chats.set(key, c);
  }
  return c;
}
const seenIds = new Set();
function rememberId(id) {
  seenIds.add(id);
  if (seenIds.size > CONFIG.MAX_SEEN_IDS) seenIds.delete(seenIds.values().next().value);
}
setInterval(() => {
  const now = Date.now();
  for (const [k, c] of chats) if (now - c.lastSeen > CONFIG.CHAT_IDLE_MS) chats.delete(k);
}, 30 * 60 * 1000).unref();

const chatQueues = new Map();
function enqueue(key, task) {
  const prev = chatQueues.get(key) || Promise.resolve();
  const next = prev.then(task).catch((e) => warn('Message handler error:', e && e.message)).finally(() => {
    if (chatQueues.get(key) === next) chatQueues.delete(key);
  });
  chatQueues.set(key, next);
  return next;
}

/* ------------------------------ message content ------------------------------ */
function unwrap(msg) {
  let cur = msg;
  for (let i = 0; i < 6 && cur; i++) {
    const inner = (cur.ephemeralMessage && cur.ephemeralMessage.message)
      || (cur.viewOnceMessage && cur.viewOnceMessage.message)
      || (cur.viewOnceMessageV2 && cur.viewOnceMessageV2.message)
      || (cur.viewOnceMessageV2Extension && cur.viewOnceMessageV2Extension.message)
      || (cur.documentWithCaptionMessage && cur.documentWithCaptionMessage.message);
    if (!inner) break;
    cur = inner;
  }
  return cur || {};
}
function extractContent(message) {
  const c = unwrap(message);
  const ctx = (c.extendedTextMessage && c.extendedTextMessage.contextInfo)
    || (c.imageMessage && c.imageMessage.contextInfo)
    || (c.videoMessage && c.videoMessage.contextInfo)
    || (c.documentMessage && c.documentMessage.contextInfo) || {};
  const mentioned = Array.isArray(ctx.mentionedJid) ? ctx.mentionedJid : [];
  let text = '';
  let kind = 'ignore';
  if (typeof c.conversation === 'string') { text = c.conversation; kind = 'text'; }
  else if (c.extendedTextMessage) { text = c.extendedTextMessage.text; kind = 'text'; }
  else if (c.buttonsResponseMessage) { text = c.buttonsResponseMessage.selectedDisplayText; kind = 'text'; }
  else if (c.listResponseMessage) { text = c.listResponseMessage.title; kind = 'text'; }
  else if (c.templateButtonReplyMessage) { text = c.templateButtonReplyMessage.selectedDisplayText; kind = 'text'; }
  else if (c.audioMessage) { kind = 'voice'; }
  else if (c.imageMessage) { text = c.imageMessage.caption; kind = 'media'; }
  else if (c.videoMessage) { text = c.videoMessage.caption; kind = 'media'; }
  else if (c.documentMessage) { text = c.documentMessage.caption; kind = 'media'; }
  else if (c.ptvMessage) { kind = 'media'; }
  return { kind, text: typeof text === 'string' ? text : '', mentioned };
}
function toNum(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && typeof v.toNumber === 'function') return v.toNumber();
  return Number(v) || 0;
}

/* ------------------------------ sending ------------------------------ */
async function sendText(sock, jid, text, opts = {}) {
  try {
    if (!opts.fast) {
      try { await sock.sendPresenceUpdate('composing', jid); } catch (_) { /* ignore */ }
      await sleep(Math.min(2500, 700 + text.length * 25 + Math.random() * 500));
    }
    await sock.sendMessage(jid, { text });
    if (!opts.fast) { try { await sock.sendPresenceUpdate('paused', jid); } catch (_) { /* ignore */ } }
    return true;
  } catch (e) {
    warn(`Failed to send message to ${maskNum(jidUser(jid))}:`, e && e.message);
    return false;
  }
}

/* ------------------------------ owner commands ------------------------------ */
function parseCommand(text) {
  const t = String(text || '').trim().replace(/^[!\/.#]/, '').replace(/\s+/g, ' ').toUpperCase();
  if (['HELP', 'STATUS', 'PAUSE', 'RESUME'].includes(t)) return { name: t };
  const m = t.match(/^LANGUAGE (EN|UR|ROMAN|AUTO)$/);
  if (m) return { name: 'LANGUAGE', value: m[1] };
  return null;
}
function runCommand(cmd) {
  switch (cmd.name) {
    case 'HELP':
      return `📖 ${SETTINGS.BOT_NAME} commands (owner only):\nHELP - show this list\nSTATUS - show auto-reply status\nLANGUAGE EN - reply in English\nLANGUAGE UR - reply in Urdu\nLANGUAGE ROMAN - reply in Roman Urdu\nLANGUAGE AUTO - match the sender's language\nPAUSE - stop automatic replies\nRESUME - enable automatic replies`;
    case 'STATUS': {
      const mins = Math.floor((Date.now() - STARTED_AT) / 60000);
      const lang = botState.language !== null ? botState.language : normalizeLang(SETTINGS.DEFAULT_LANGUAGE);
      return `📊 ${SETTINGS.BOT_NAME}\nAuto-reply: ${botState.paused ? 'PAUSED ⏸️' : 'ACTIVE ✅'}\nReply language: ${lang.toUpperCase()}\nActive chats (this run): ${chats.size}\nUptime: ${Math.floor(mins / 60)}h ${mins % 60}m`;
    }
    case 'PAUSE':
      botState.paused = true; saveBotState();
      return '⏸️ Auto-reply paused. Send RESUME to turn it back on.';
    case 'RESUME':
      botState.paused = false; saveBotState();
      return '✅ Auto-reply resumed.';
    case 'LANGUAGE': {
      const map = { EN: 'en', UR: 'ur', ROMAN: 'roman', AUTO: 'auto' };
      botState.language = map[cmd.value]; saveBotState();
      const names = { en: 'English', ur: 'Urdu', roman: 'Roman Urdu', auto: "AUTO (same as the sender's language)" };
      return `🌐 Reply language set to ${names[botState.language]}.`;
    }
    default: return 'Unknown command.';
  }
}

/* ------------------------------ message handling ------------------------------ */
async function handleMessage(sock, m) {
  if (!m || !m.key || !m.message) return;
  const key = m.key;
  if (key.id) { if (seenIds.has(key.id)) return; rememberId(key.id); }
  if (key.fromMe) return;

  const jid = key.remoteJid;
  if (!jid) return;
  if (jid === 'status@broadcast') {
    if (SETTINGS.ENABLE_STATUS_MESSAGES) log('Status update received (status updates are never auto-replied).');
    return;
  }
  if (jid.endsWith('@newsletter') || jid.endsWith('@broadcast')) return;
  const isGroup = jid.endsWith('@g.us');
  if (isGroup && !SETTINGS.ENABLE_GROUP_MESSAGES) return;
  if (!isGroup && !(jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid'))) return;

  const ts = toNum(m.messageTimestamp);
  if (ts && Date.now() / 1000 - ts > CONFIG.MAX_MESSAGE_AGE_S) return;

  const senderJid = isGroup ? key.participant : jid;
  const senderAlt = isGroup ? key.participantAlt : key.remoteJidAlt;
  const senderNumber = numberFromJids([senderJid, senderAlt]);
  const selfNumber = jidUser(sock.user && sock.user.id);
  if (senderNumber && (senderNumber === BOT_INTL || senderNumber === selfNumber)) return;

  const content = extractContent(m.message);
  if (content.kind === 'ignore') return;

  if (isGroup) {
    const me = [sock.user && sock.user.id, sock.user && sock.user.lid].filter(Boolean).map(jidUser);
    if (!content.mentioned.some((j) => me.includes(jidUser(j)))) return;
  }

  const isOwner = !isGroup && !!OWNER_INTL && senderNumber === OWNER_INTL;
  if (isOwner && content.kind === 'text') {
    const cmd = parseCommand(content.text);
    if (cmd) {
      log(`Owner command: ${cmd.name}`);
      await sendText(sock, jid, runCommand(cmd), { fast: true });
      return;
    }
  }

  if (botState.paused) return;

  const now = Date.now();
  const chat = getChat(jid);
  chat.lastSeen = now;
  chat.count++;

  const raw = String(content.text || '').slice(0, 1000).trim();
  const norm = normalize(raw);
  const words = norm ? norm.split(' ') : [];

  // Media / voice without usable text
  if (!norm) {
    if (content.kind === 'text') return; // emoji-only or empty text
    if (now - chat.lastMediaNoticeAt < CONFIG.MEDIA_NOTICE_COOLDOWN_MS) return;
    const lang = resolveLang(chat.lastLang || 'en');
    const ok = await sendText(sock, jid, pickReply(chat, content.kind === 'voice' ? 'voice' : 'media', lang));
    if (ok) chat.lastMediaNoticeAt = now;
    return;
  }

  // Repeated identical spam
  const prev = chat.history[chat.history.length - 1];
  chat.history.push({ t: now, text: norm });
  if (chat.history.length > 10) chat.history.shift();
  if (prev && prev.text === norm && now - prev.t < 8000) return;

  // Loop protection
  chat.replyTimes = chat.replyTimes.filter((t) => now - t < 60000);
  if (chat.replyTimes.length >= CONFIG.MAX_REPLIES_PER_MIN) {
    warn(`Reply rate limit reached for ${maskNum(jidUser(jid))}; ignoring message.`);
    return;
  }

  const detected = detectLang(raw, norm, words, chat);
  chat.lastLang = detected;
  const lang = resolveLang(detected);

  // Custom rules from SETTINGS
  const padded = ' ' + norm + ' ';
  const custom = CUSTOM_RULES.find((r) => padded.includes(' ' + r.trigger + ' '));
  if (custom) {
    const ok = await sendText(sock, jid, fill(custom.reply));
    if (ok) { chat.lastKey = 'custom'; chat.lastReplyAt = now; chat.replyTimes.push(now); }
    return;
  }

  const cls = classify(raw, norm, words);
  let replyKey = cls.key;
  if ((replyKey === 'salam' || replyKey === 'greeting') && now - chat.lastGreetAt < CONFIG.GREET_COOLDOWN_MS) {
    replyKey = 'greet_again';
  }
  if (SILENT_REPEAT.has(replyKey) && chat.lastKey === replyKey && now - chat.lastReplyAt < CONFIG.SILENT_REPEAT_MS) {
    return; // avoid endless "ok" / "thanks" ping-pong
  }

  const text = (replyKey === 'greeting' && SETTINGS.CUSTOM_GREETING)
    ? fill(SETTINGS.CUSTOM_GREETING)
    : pickReply(chat, replyKey, lang);

  log(`Reply -> chat ${maskNum(jidUser(jid))} | intent=${cls.intent} | key=${replyKey} | lang=${lang}`);
  const ok = await sendText(sock, jid, text);
  if (ok) {
    chat.lastKey = replyKey;
    chat.lastIntent = cls.intent;
    chat.lastReplyAt = Date.now();
    chat.replyTimes.push(Date.now());
    if (GREET_KEYS.has(replyKey)) chat.lastGreetAt = Date.now();
  }
}

/* ------------------------------ Baileys connection ------------------------------ */
async function loadBaileys() {
  const ns = await import('@whiskeysockets/baileys');
  const root = ns.default && typeof ns.default === 'object' ? ns.default : ns;
  const get = (k) => (ns[k] !== undefined ? ns[k] : root[k]);
  const makeWASocket = typeof ns.default === 'function' ? ns.default
    : (typeof root.default === 'function' ? root.default : (root.makeWASocket || ns.makeWASocket));
  const api = {
    makeWASocket,
    useMultiFileAuthState: get('useMultiFileAuthState'),
    fetchLatestBaileysVersion: get('fetchLatestBaileysVersion'),
    DisconnectReason: get('DisconnectReason'),
    Browsers: get('Browsers'),
  };
  for (const [k, v] of Object.entries(api)) if (!v) throw new Error(`Baileys export missing: ${k}`);
  return api;
}

let sock = null;
let generation = 0;
let connecting = false;
let reconnectTimer = null;

function wipeSession() {
  try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch (e) { warn('Could not remove session:', e.message); }
  loadBotState();
}
function scheduleReconnect(ms) {
  if (reconnectTimer) return;
  log(`Reconnecting in ${Math.round(ms / 1000)} seconds...`);
  reconnectTimer = setTimeout(() => { reconnectTimer = null; start(); }, ms);
}

async function start() {
  if (connecting) return;
  connecting = true;
  const gen = ++generation;
  try {
    if (sock) { try { sock.end(undefined); } catch (_) { /* ignore */ } }
    const B = await loadBaileys();
    const { state, saveCreds } = await B.useMultiFileAuthState(SESSION_DIR);
    const { version } = await B.fetchLatestBaileysVersion();
    const s = B.makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: B.Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    sock = s;
    let pairingRequested = false;
    let closeHandled = false;

    s.ev.on('creds.update', saveCreds);

    s.ev.on('connection.update', async (u) => {
      if (gen !== generation) return;
      const { connection, lastDisconnect, qr } = u;

      if (qr && !s.authState.creds.registered) {
        console.log('QR LINK: https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=' + encodeURIComponent(qr));
        if (!pairingRequested) {
          pairingRequested = true;
          try { qrcode.generate(qr, { small: true }); } catch (_) { /* ignore */ }
          if (!BOT_INTL) {
            console.error('ERROR: BOT_WHATSAPP_NUMBER in SETTINGS is invalid. Use format 03XXXXXXXXX.');
            process.exit(1);
          }
          setTimeout(async () => {
            if (gen !== generation) return;
            try {
              const code = await s.requestPairingCode(BOT_INTL);
              const pretty = String(code).replace(/[^A-Za-z0-9]/g, '').match(/.{1,4}/g);
              console.log('PAIRING CODE: ' + (pretty ? pretty.join('-') : code));
            } catch (e) {
              warn('Pairing code request failed:', e && e.message);
              try { s.end(new Error('pairing request failed')); } catch (_) { /* ignore */ }
            }
          }, 1000);
        }
      }

      if (connection === 'open') {
        log('PERSONAL WHATSAPP ASSISTANT IS LIVE!');
      }

      if (connection === 'close') {
        if (closeHandled) return;
        closeHandled = true;
        const err = lastDisconnect && lastDisconnect.error;
        const code = err && err.output ? err.output.statusCode : undefined;
        log(`Connection closed (code: ${code === undefined ? 'unknown' : code}).`);
        if (code === B.DisconnectReason.loggedOut) {
          log('Logged out. Removing old session and starting fresh pairing...');
          wipeSession();
          scheduleReconnect(CONFIG.RECONNECT_DELAY_MS);
        } else if (code === B.DisconnectReason.connectionReplaced) {
          log('Connection replaced by another instance. Waiting 30 seconds...');
          scheduleReconnect(30000);
        } else {
          scheduleReconnect(CONFIG.RECONNECT_DELAY_MS);
        }
      }
    });

    s.ev.on('messages.upsert', ({ messages, type }) => {
      if (gen !== generation || type !== 'notify' || !Array.isArray(messages)) return;
      for (const m of messages) {
        const qk = (m && m.key && m.key.remoteJid) || 'unknown';
        enqueue(qk, () => handleMessage(s, m));
      }
    });
  } catch (e) {
    warn('Start failed:', e && e.message);
    scheduleReconnect(CONFIG.RECONNECT_DELAY_MS);
  } finally {
    connecting = false;
  }
}

/* ------------------------------ process safety ------------------------------ */
process.on('unhandledRejection', (e) => warn('Unhandled rejection:', e && e.message ? e.message : e));
process.on('uncaughtException', (e) => warn('Uncaught exception:', e && e.message ? e.message : e));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { log(`${sig} received. Shutting down.`); process.exit(0); });
}

log(`Starting ${SETTINGS.BOT_NAME}...`);
if (!BOT_INTL) warn('BOT_WHATSAPP_NUMBER looks invalid (expected 03XXXXXXXXX).');
if (!OWNER_INTL) warn('OWNER_NUMBER looks invalid: owner commands are disabled until it is set.');
loadBotState();
start();
