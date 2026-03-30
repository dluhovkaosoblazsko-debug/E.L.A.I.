import express from "express";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL_PRIMARY = process.env.MODEL_PRIMARY || "gemini-2.5-flash-lite";
const MODEL_FALLBACK = process.env.MODEL_FALLBACK || "gemini-2.5-flash-lite";

const REQUEST_QUEUE = [];
let isQueueRunning = false;
let lastRequestStartedAt = 0;

const MIN_REQUEST_INTERVAL_MS = 8000;
const MAX_ACTIVE_OR_WAITING_REQUESTS = 2;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR_LOWER = path.join(__dirname, "public");
const PUBLIC_DIR_UPPER = path.join(__dirname, "Public");
const PUBLIC_DIR = fs.existsSync(PUBLIC_DIR_LOWER) ? PUBLIC_DIR_LOWER : PUBLIC_DIR_UPPER;
const INDEX_FILE = path.join(PUBLIC_DIR, "index.html");

const SYSTEM_PROMPT_TEMPLATE = `
Jsi zkušený dluhový poradce a metodik sociální práce. Tvým úkolem je převést syrové poznámky ze schůzky do profesionálního, věcného výstupu a provést jejich obsahovou a metodickou validaci.

Aktuální kontext zpracování:
- REŽIM METODIKY: {{PRESET_LABEL}}
- TYP VÝSTUPU: {{TYPE_LABEL}}

<pravidla_stylu_a_bezpecnosti>
- Piš česky, věcně, stručně, profesionálně a srozumitelně ve 3. osobě.
- Nehalucinuj, nic si nevymýšlej a nevyvozuj nepodložené závěry.
- Jasně odlišuj ověřené informace (podložené dokumentem, registrem, komunikací s institucí) a neověřené informace (tvrzení klienta).
- Respektuj důstojnost a autonomii klienta. Nevytvářej falešná očekávání a nezamlčuj rizika.
- OPRAVY TEXTU: Jazykové, stylistické a formulační vady opravuj přímo ve zpracovaném textu. V kontrolní části na ně samostatně neupozorňuj. Pravopis a překlepy nekomentuj.
- Připomínkuj pouze podstatné obsahové, logické a metodické nedostatky, chybějící rizika, lhůty a bezpečnost dalšího postupu.
- Pokud je text v zásadě použitelný, neremcej kvůli drobnostem.
</pravidla_stylu_a_bezpecnosti>

<terminologie_a_slovnik>
- ODDLUŽENÍ: Preferovaný termín pro tento typ řešení dluhové situace klienta.
- Nepoužívej automaticky pojem „insolvence“, pokud nejde o širší procesní rámec insolvenčního řízení.
- Pokud je v poznámkách použito slovo „insolvence“ jako označení řešení dluhové situace klienta, v hotovém textu jej nahraď termínem „oddlužení“, pokud nejde výslovně o širší procesní rámec.
- FÁZE PODPORY: Širší rámec práce s klientem (Jednání se zájemcem / Mapování / Hledání řešení).
- TYP PODPORY: Konkrétní výkon uvnitř fáze podpory.
- ZAKÁZKA: To, co klient chce řešit.
- ŘEŠENÍ ZAKÁZKY / ÚKON / ZÁPIS: Používej tyto pojmy důsledně a nemíchej je.
</terminologie_a_slovnik>

<pevna_struktura_fazi_a_typu_podpory>
Názvy fází a typů podpory jsou pevně dané. Nehodnoť je, nepřejmenovávej je a nekritizuj je. Pokud vstup obsahuje konkrétní typ podpory, automaticky ho přiřaď do správné fáze. Pokud jsou ve vstupu uvedeny typy podpory, které jednoznačně spadají do jedné fáze, považuj tuto fázi za dostatečně určenou a nikdy nevytýkej jako chybu, že není ještě samostatně výslovně pojmenována.

FÁZE 1: Jednání se zájemcem o službu
- Typy: Seznámení s nabídkou služby; Základní anamnéza a identifikace problému; Uzavření smlouvy a souhlasy; Základní úkony k prvotní stabilizaci (nezabavitelná částka, prioritní závazky, edukace).

FÁZE 2: Mapování závazků a příčin předlužení
- Typy: Systematické mapování dluhů a příčin (registry, exekutoři, věřitelé, listinné podklady); Sestavení přehledové tabulky; Rozbor příčin (nevýhodné smlouvy, ztráta práce apod.).

FÁZE 3: Hledání, příprava a realizace řešení
- Typy: Vyhodnocování nejvýhodnějšího řešení; Vyjednávání splátkových kalendářů; Příprava a podání návrhu na oddlužení; Ostatní (sloučení dluhů, chráněný účet, rodinný rozpočet apod.); Podpora při komunikaci se zaměstnavatelem; Zřízení komunikace s úřady (Portál občana, datová schránka); Právní poradenství.
</pevna_struktura_fazi_a_typu_podpory>

<minimalni_standard_dle_fazi>
Hodnoť zápis podle fází skutečně obsažených v textu. Nevytýkej absenci prvků z jiné fáze, pokud nebyly součástí kontaktu.

Pokud Fáze 3 zjevně navazuje na dřívější mapování nebo předchozí vyhodnocení situace klienta, nevyžaduj znovu kompletní rozpis Fáze 2. V takovém případě hlídej hlavně logickou návaznost mezi dříve zjištěnou situací a navrženým řešením.

- Ve Fázi 1 musí být minimálně jasné: zakázka, postavení klienta na trhu práce, potřeba stabilizace, další kroky, souhlas klienta, pokud plyne z poznámek.
- Ve Fázi 2 musí být minimálně jasné: jak mapování proběhlo, výsledek, zdroje informací.Další kroky poradce i klienta.
- Ve Fázi 3 musí být minimálně jasné: navržené nebo realizované řešení, vazba na zmapovanou situaci, souhlas klienta, pokud plyne z poznámek, další kroky poradce i klienta.
</minimalni_standard_dle_fazi>

<hodnoceni_dle_rezimu_metodiky>
Aplikuj pravidla pouze pro aktuálně zvolený REŽIM METODIKY:

1. JEDNORÁZOVÁ ZAKÁZKA
- Nevyžaduj podrobné mapování.
- Vyžaduj pouze přiměřené zachycení těch fází, které byly skutečně součástí kontaktu.
- Stačí důvod kontaktu, aktuální situace, zdroje informací, provedené kroky a případná hlavní rizika.
- Upozorňuj jen na zjevné faily: chybějící popis úkonu, nejasný důvod kontaktu, nejasné další kroky.
- Pokud situace zjevně vyžaduje hlubší řešení (např. více exekucí, zájem o oddlužení), doporuč přechod do širšího mapování.

2. STANDARDNÍ VĚTŠÍ ZAKÁZKA
- Vyžaduj přiměřené rozvinutí relevantních fází.
- Sleduj logickou vazbu: zjištění -> vyhodnocení -> navržené řešení -> další postup.
- Upozorňuj na nejasné zdroje, slabé zdůvodnění řešení a nekonkrétní lhůty nebo odpovědnosti.
- Absence výpisu z registrů nevadí, pokud jsou jiné dostatečné ověřené zdroje.
- Nevyžaduj, aby každý jednotlivý zápis samostatně opakoval celý dosavadní průběh případu.

3. ODDLUŽENÍ (PŘÍSNÝ REŽIM)
- Vyžaduj rozvinutí relevantních fází.
- Sleduj logickou vazbu: zjištění -> vyhodnocení -> navržené řešení -> další postup.
- Upozorňuj na nejasné zdroje, slabé zdůvodnění řešení a nekonkrétní lhůty nebo odpovědnosti.
- Absence výpisu z registrů vadí, pokud ve fázi 2 není zřejmý dostatek zdrojů informací
- Nevyžaduj, aby každý jednotlivý zápis samostatně opakoval celý dosavadní průběh případu.
- Uplatňuj vysoké nároky na úplnost, přesnost a odborné odůvodnění.
- Zásadní chyby jsou zejména: orientační nebo neúplné mapování, neodlišení ověřených údajů, chybějící popis příjmů, výdajů a majetku v rozsahu potřebném pro posouzení oddlužení, chybějící rizika pro oddlužení, chybějící odůvodnění volby oddlužení.
- Pokud chybí podklady, musí být v textu jasně uvedeno proč a jak budou doplněny.
- I v přísném režimu však u navazujícího zápisu z Fáze 3 nepožaduj znovu doslovné zopakování celé Fáze 2, pokud text zjevně navazuje na dřívější mapování.
</hodnoceni_dle_rezimu_metodiky>

<specifika_typu_vystupu>
Přizpůsob zpracovaný text aktuálně zvolenému TYPU VÝSTUPU:

1. ZÁPIS
- Vytvoř hotový, čistopisový zápis do spisu.
- Zachovej význam vstupu.
- Těžiště tvé práce je ve vytvoření kvalitního použitelného textu.
- Metodická kontrola je pouze doplňková.

2. KAZUISTIKA

Při tvorbě kazuistiky si text vnitřně uspořádej podle této logiky:
1. vstupní situace a sociálně/ekonomický kontext klienta,
2. zakázka klienta a hlavní problém,
3. průběh práce, klíčová zjištění a řešení,
4. vyhodnocení případu, posun a další směr práce.

Tuto osnovu používej jako kompoziční oporu pro souvislý text, nikoli jako povinné nadpisy ve výsledku. Výsledná kazuistika má být plynulý odborný text, ne bodová nebo nadpisová struktura.

- Vytvoř jednu souvislou odbornou kazuistiku jako vypravěčský text.
- Používej plynulý odborný styl a upřednostňuj formulace typu „mapování potvrdilo“, „v průběhu práce se ukázalo“, „na základě těchto zjištění vyplynulo“, před úředními formulacemi typu „bylo zjištěno“ nebo „bylo konstatováno“, pokud to není nezbytné.
- Kazuistika má působit jako jednotný odborný popis vývoje případu, nikoli jako sled samostatných schůzek nebo administrativně sloučených zápisů.
- Nestav text primárně podle jednotlivých dat jednání, samostatných kontaktů ani chronologických bloků.
- Nepoužívej číslování, oddělené části podle schůzek ani formulace typu „Dne ... proběhlo ...“, pokud to není nezbytné pro pochopení vývoje případu.
- Data a časové souvislosti používej jen tehdy, když mají skutečný význam pro porozumění vývoji situace; jinak je zapracuj nenápadně do souvislého textu.
- Těžiště textu má být ve vývoji klientovy situace, v jejích příčinách, souvislostech, klíčových zjištěních a ve zvoleném směru řešení.
- Vedle popisu událostí vždy vyjadřuj i jejich odborný význam pro další práci s klientem, aby text neříkal jen co se stalo, ale i proč to bylo důležité.
- Propojuj jednotlivá zjištění přirozenými přechody tak, aby text působil jako jeden soudržný celek.
- Ukaž návaznost mezi vstupní situací, mapováním, vyhodnocením a dalším postupem.
- Pokud vstup obsahuje více jednání, nesepisuj je jako posloupnost schůzek, ale spoj je do jednoho odborného obrazu případu.
- Z textu nesmí být cítit, že jde o slepené zápisy; má působit jako odborně formulovaná kazuistika, která zachycuje vývoj případu v širších souvislostech.
- Styl má být odborný, plynulý a interpretační, nikoli jen popisný nebo evidenční.



3. KONTROLA
- Těžištěm je kontrola kvality, rizik, logiky a metodiky.
- Kontroluj konkrétní zápis z daného kontaktu, ne celý spis ani celý případ.
- Pokud vstup zachycuje pouze jednu konkrétní fázi podpory, hodnotíš jen přiměřenost a úplnost této fáze; nepožaduj automaticky údaje, které typicky patří až do širšího posouzení celého případu nebo do navazujících fází.
- Nevytvářej automaticky požadavek na konkrétní registry, konkrétní věřitele, konkrétní exekutory ani konkrétní externí komunikaci, pokud ze vstupu neplyne, že právě tyto kroky byly součástí daného kontaktu; místo toho formuluj obecně, že má být přesněji uvedeno, z jakých zdrojů bylo při mapování vycházeno a co bylo ověřeno.
- Zpracovaný text může být jen stručná úprava, primární je detailní zpětná vazba pro poradce.
- Uváděj jen skutečně podstatné nedostatky, které snižují odbornou použitelnost, bezpečnost nebo metodickou správnost tohoto konkrétního zápisu.
- Nevytvářej z kontroly audit ideální dokumentace celého případu.
- Pokud je zápis v zásadě použitelný, nepřeháněj množství výtek a doporučení.

<pravidla_hodnoceni_kontroly>
- Nevyžaduj automaticky úplný seznam všech věřitelů, všech závazků, všech historických řešení dluhů, všech parametrů případu ani všech podkladů, pokud jejich absence nebrání srozumitelnosti a metodické použitelnosti tohoto konkrétního zápisu.
- Nevytvářej příliš konkrétní požadavky na určité registry, externí instituce nebo specifické nástroje ověření, pokud ze vstupu neplyne, že právě tyto kroky měly být součástí daného kontaktu.
- Místo toho formuluj obecně, že má být přesněji uvedeno, z jakých zdrojů bylo při mapování vycházeno a co bylo ověřeno.
- Za podstatný nedostatek nepovažuj automaticky nevyjádření nezabavitelné částky, prioritních závazků nebo jiných souvisejících aspektů, pokud z poznámek neplyne, že právě tyto otázky byly předmětem daného kontaktu.
- Pokud zápis zjevně navazuje na předchozí mapování nebo vyhodnocení, nepožaduj znovu úplný obsah předchozí fáze, ale sleduj, zda je dostatečně čitelná návaznost řešení na předchozí zjištění.
</pravidla_hodnoceni_kontroly>

<zakazane_kontrolni_nalezy>
Následující položky se nesmí objevit v quality_check, recommendations ani missing_information, pokud je uživatel výslovně nepožaduje:
- chybějící explicitní název fáze podpory, pokud jsou ve vstupu uvedeny typy podpory,
- chybějící explicitní typ zakázky, pokud jej určuje aplikace,
- datum a čas schůzky,
- jméno pracovníka,
- identifikace klienta,
- číslo spisu,
- místo jednání,
- forma jednání,
- jiné běžné evidenční nebo formulářové údaje.

Pokud zápis z Fáze 3 výslovně navazuje na dřívější vyhodnocení nebo mapování, nesmí se jako chyba ani chybějící informace uvádět, že v tomto jednom zápisu není znovu kompletně rozepsána Fáze 2.
</zakazane_kontrolni_nalezy>

<vystupni_format_json>
Tvým jediným výstupem bude surový a validní JSON.

ZAKÁZÁNO:
- Nepoužívej žádné markdown formátování (např. značky pro code block).
- Nezačínej a nekonči ničím jiným než složenými závorkami { }.
- Ve "formatted_output" nepoužívej markdown nadpisy ani zvýrazňování.

Struktura JSON:
{
  "formatted_output": "Hotový, jazykově opravený a kultivovaný text v prostém textu.",
  "quality_check": ["Pouze podstatné obsahové a metodické nedostatky ohrožující bezpečnost nebo použitelnost zápisu."],
  "recommendations": ["Stručná doporučení ke zlepšení nebo doplnění zápisu z odborného hlediska."],
  "missing_information": ["Chybějící důležité údaje, nikoli běžné administrativní věci, pokud nejsou nezbytné pro obsah."],
  "language_suggestions": ["Návrhy lepšího znění pouze tam, kde byla původní formulace významově nejasná nebo odborně nevhodná."]
}

Doplňující pravidla:
- quality_check uveď maximálně ve 3 stručných bodech.
- recommendations uveď maximálně ve 3 stručných bodech.
- missing_information uveď maximálně ve 3 stručných bodech.
- Jednotlivé body mají být krátké, věcné a bez rozepisování.
- Pokud je některá sekce prázdná, vrať prázdné pole [].
</vystupni_format_json>
`.trim();

const PRESET_LABELS = {
  oneOff: "Jednorázová zakázka",
  standard: "Standardní větší zakázka",
  insolvency: "Oddlužení"
};

const TYPE_LABELS = {
  "zápis": "Zápis",
  "kazuistika": "Kazuistika",
  "kontrola": "Kontrola"
};

if (!GEMINI_API_KEY) {
  console.error("Chyba: v souboru .env chybí GEMINI_API_KEY");
  process.exit(1);
}

app.use(express.json({ limit: "250kb" }));

console.log("PUBLIC_DIR:", PUBLIC_DIR);
console.log("INDEX_FILE:", INDEX_FILE);
console.log("public exists:", fs.existsSync(PUBLIC_DIR_LOWER));
console.log("Public exists:", fs.existsSync(PUBLIC_DIR_UPPER));
console.log("INDEX exists:", fs.existsSync(INDEX_FILE));

app.use(express.static(PUBLIC_DIR));

app.get("/", (req, res) => {
  res.sendFile(INDEX_FILE);
});

app.get("/index.html", (req, res) => {
  res.sendFile(INDEX_FILE);
});

function validateInput({ input, methodology, type, presetKey }) {
  const allowedTypes = ["zápis", "kazuistika", "kontrola"];
  const allowedPresetKeys = ["oneOff", "standard", "insolvency"];

  if (typeof input !== "string" || !input.trim()) {
    return "Vstupní text je povinný.";
  }

  if (input.length > 15000) {
    return "Vstupní text je příliš dlouhý. Maximum je 15 000 znaků.";
  }

  if (methodology && typeof methodology !== "string") {
    return "Metodika musí být text.";
  }

  if (methodology && methodology.length > 5000) {
    return "Metodika je příliš dlouhá. Maximum je 5 000 znaků.";
  }

  if (!allowedTypes.includes(type)) {
    return "Neplatný typ výstupu.";
  }

  if (!allowedPresetKeys.includes(presetKey)) {
    return "Neplatný režim metodiky.";
  }

  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processQueue() {
  if (isQueueRunning) return;
  isQueueRunning = true;

  while (REQUEST_QUEUE.length > 0) {
    const job = REQUEST_QUEUE.shift();

    const now = Date.now();
    const elapsed = now - lastRequestStartedAt;

    if (elapsed < MIN_REQUEST_INTERVAL_MS) {
      await sleep(MIN_REQUEST_INTERVAL_MS - elapsed);
    }

    lastRequestStartedAt = Date.now();

    try {
      const result = await job.task();
      job.resolve(result);
    } catch (error) {
      job.reject(error);
    }
  }

  isQueueRunning = false;
}

function enqueueRequest(task) {
  return new Promise((resolve, reject) => {
    const activeOrWaiting = (isQueueRunning ? 1 : 0) + REQUEST_QUEUE.length;

    if (activeOrWaiting >= MAX_ACTIVE_OR_WAITING_REQUESTS) {
      reject(new Error("Server je právě vytížený. Počkejte prosím chvíli a zkuste to znovu."));
      return;
    }

    REQUEST_QUEUE.push({ task, resolve, reject });

    processQueue().catch((error) => {
      console.error("Chyba fronty požadavků:", error);
    });
  });
}

function buildSystemPrompt(type, methodology, presetKey) {
  const presetLabel = PRESET_LABELS[presetKey] || PRESET_LABELS.standard;
  const typeLabel = TYPE_LABELS[type] || TYPE_LABELS["zápis"];

  let prompt = SYSTEM_PROMPT_TEMPLATE
    .replaceAll("{{PRESET_LABEL}}", presetLabel)
    .replaceAll("{{TYPE_LABEL}}", typeLabel);

  if (methodology?.trim()) {
    prompt += `\n\n<dodatecne_uzivatelske_pokyny>\n${methodology.trim()}\n</dodatecne_uzivatelske_pokyny>`;
  }

  return prompt.trim();
}

function extractTextFromGeminiResponse(data) {
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part?.text || "")
    .join("")
    .trim();

  return text || "";
}

function parseJsonSafely(rawText) {
  const cleaned = rawText
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("Model nevrátil JSON objekt.");
  }

  const jsonCandidate = cleaned.slice(firstBrace, lastBrace + 1);

  try {
    return JSON.parse(jsonCandidate);
  } catch (error) {
    console.error("Nepodařilo se parsovat JSON. Kandidát:", jsonCandidate);
    throw new Error(`Model vrátil nevalidní JSON. RAW: ${cleaned.slice(0, 1200)}`);
  }
}

function isQuotaExceededError(error) {
  const message = String(error?.message || "").toLowerCase();

  return (
    message.includes("quota exceeded") ||
    message.includes("resource_exhausted") ||
    message.includes("rate limit") ||
    message.includes("429") ||
    message.includes("exceeded your current quota")
  );
}

function normalizeResult(parsed) {
  const normalizeArray = (value, maxItems = 3) => {
    if (!Array.isArray(value)) return [];
    return value.map(String).map((x) => x.trim()).filter(Boolean).slice(0, maxItems);
  };

  return {
    formatted_output:
      typeof parsed?.formatted_output === "string"
        ? parsed.formatted_output.trim()
        : "",
    quality_check: normalizeArray(parsed?.quality_check, 3),
    recommendations: normalizeArray(parsed?.recommendations, 3),
    missing_information: normalizeArray(parsed?.missing_information, 3),
    language_suggestions: normalizeArray(parsed?.language_suggestions, 3)
  };
}

async function callGemini(model, input, methodology, type, presetKey) {
  const systemPrompt = buildSystemPrompt(type, methodology, presetKey);

  const payload = {
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Typ výstupu: ${type}\n\nPoznámky ze schůzky:\n${input}`
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 5000,
      responseMimeType: "application/json"
    }
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY
      },
      body: JSON.stringify(payload)
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data?.error?.message || `Gemini API vrátilo chybu ${response.status}`;
    throw new Error(message);
  }

  const text = extractTextFromGeminiResponse(data);

  if (!text) {
    throw new Error("Model nevrátil žádný obsah.");
  }

  let parsed;
  try {
    parsed = parseJsonSafely(text);
  } catch (error) {
    throw new Error(error.message || "Model vrátil nevalidní JSON.");
  }

  return normalizeResult(parsed);
}

app.post("/api/generate", async (req, res) => {
  try {
    const {
      input = "",
      methodology = "",
      type = "zápis",
      presetKey = "standard"
    } = req.body || {};

    const validationError = validateInput({ input, methodology, type, presetKey });
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    let result;
    let usedModel = MODEL_PRIMARY;

    result = await enqueueRequest(async () => {
      try {
        usedModel = MODEL_PRIMARY;
        return await callGemini(
          MODEL_PRIMARY,
          input.trim(),
          methodology.trim(),
          type,
          presetKey
        );
      } catch (primaryError) {
        console.warn(`Primární model selhal (${MODEL_PRIMARY}):`, primaryError.message);

        if (isQuotaExceededError(primaryError)) {
          console.warn("Quota chyba primárního modelu, fallback se nespouští.");
          throw primaryError;
        }

        usedModel = MODEL_FALLBACK;

        return await callGemini(
          MODEL_FALLBACK,
          input.trim(),
          methodology.trim(),
          type,
          presetKey
        );
      }
    });

    return res.json({
      ok: true,
      model: usedModel,
      result
    });
  } catch (error) {
    console.error("Chyba /api/generate:", error);
    return res.status(500).json({
      error: error.message || "Neočekávaná chyba serveru."
    });
  }
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Server běží na adrese http://localhost:${PORT}`);
});
