/**
 * Voice-line MCP server.
 *
 * Generates the game's spoken lines from content/voice-lines.json using Amazon Polly
 * STOCK synthetic voices, and writes:
 *   public/audio/voice/<id>.mp3
 *   public/audio/voice/index.json   (id -> file, caption, effect, text hash)
 *
 * Tools:
 *   list_voices          -> what Polly voices are available (verify names before using them)
 *   synthesize_line      -> one ad hoc line
 *   synthesize_manifest  -> every line in the manifest; skips lines whose text has not changed
 *
 * Rules baked in:
 *   - Stock voices only. This server never clones or imitates a real person.
 *   - Every line needs a caption (the game shows captions for all audio).
 *   - Set TTS_DRY_RUN=1 to plan without calling AWS (no cost, no files written).
 *   - Lo-fi effects (answering machine, tape, reversal) are NOT baked in. The manifest's
 *     "effect" field tells the Web Audio layer what to apply at runtime, so you can tweak
 *     them without regenerating audio.
 *
 * This is a stdio MCP server: never write to stdout. Use console.error.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { PollyClient, SynthesizeSpeechCommand, DescribeVoicesCommand, type VoiceId, type Engine } from '@aws-sdk/client-polly';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = 'public/audio/voice';
const INDEX_PATH = join(OUT_DIR, 'index.json');
const MANIFEST_PATH = 'content/voice-lines.json';
const DRY_RUN = process.env.TTS_DRY_RUN === '1';

const polly = new PollyClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const server = new McpServer({ name: 'voice-lines', version: '0.1.0' });

const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] });
const fail = (err: unknown) => ({
  isError: true,
  content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }],
});

const LineSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/, 'lowercase letters, digits, underscores only'),
  speaker: z.string(),
  voice: z.string(),
  engine: z.enum(['neural', 'standard']).default('neural'),
  text: z.string().min(1).max(600),
  caption: z.string().min(1),
  effect: z.enum(['none', 'answering_machine', 'tape', 'record_reversible', 'camcorder']).default('none'),
  notes: z.string().optional(),
});
type Line = z.infer<typeof LineSchema>;
const ManifestSchema = z.object({ lines: z.array(LineSchema) });

interface IndexEntry {
  file: string;
  caption: string;
  effect: string;
  speaker: string;
  textHash: string;
  voice: string;
}
type Index = Record<string, IndexEntry>;

const hashOf = (l: Pick<Line, 'text' | 'voice' | 'engine'>): string =>
  createHash('sha1').update(`${l.voice}|${l.engine}|${l.text}`).digest('hex').slice(0, 12);

async function readIndex(): Promise<Index> {
  if (!existsSync(INDEX_PATH)) return {};
  return JSON.parse(await readFile(INDEX_PATH, 'utf8')) as Index;
}

async function synth(text: string, voice: string, engine: string): Promise<Uint8Array> {
  const res = await polly.send(
    new SynthesizeSpeechCommand({
      Text: text,
      TextType: 'text',
      OutputFormat: 'mp3',
      VoiceId: voice as VoiceId,
      Engine: engine as Engine,
      LanguageCode: 'en-US',
    }),
  );
  if (!res.AudioStream) throw new Error('Polly returned no audio.');
  return await res.AudioStream.transformToByteArray();
}

async function renderLine(line: Line, index: Index): Promise<string> {
  const file = `${line.id}.mp3`;
  if (DRY_RUN) return `DRY RUN: would synthesize ${line.id} with ${line.voice} (${line.engine})`;
  const audio = await synth(line.text, line.voice, line.engine);
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, file), audio);
  index[line.id] = {
    file,
    caption: line.caption,
    effect: line.effect,
    speaker: line.speaker,
    textHash: hashOf(line),
    voice: line.voice,
  };
  return `Generated ${line.id} with ${line.voice}`;
}

server.tool(
  'list_voices',
  'List available Amazon Polly voices for a language. Check this before putting a voice name in the manifest.',
  { language: z.string().default('en-US'), engine: z.enum(['neural', 'standard']).default('neural') },
  async ({ language, engine }) => {
    try {
      const res = await polly.send(new DescribeVoicesCommand({ LanguageCode: language as never, Engine: engine as Engine }));
      const voices = (res.Voices ?? []).map((v) => `${v.Id} (${v.Gender}, ${v.LanguageName})`);
      return ok(voices.join('\n') || 'No voices returned.');
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  'synthesize_line',
  'Synthesize a single line and add it to the audio index. For one-offs; the manifest is preferred.',
  {
    id: z.string().regex(/^[a-z0-9_]+$/),
    text: z.string().min(1).max(600),
    caption: z.string().min(1),
    voice: z.string().default('Matthew'),
    engine: z.enum(['neural', 'standard']).default('neural'),
    speaker: z.string().default('narrator'),
    effect: z.enum(['none', 'answering_machine', 'tape', 'record_reversible', 'camcorder']).default('none'),
  },
  async (args) => {
    try {
      const index = await readIndex();
      const msg = await renderLine(args, index);
      if (!DRY_RUN) await writeFile(INDEX_PATH, JSON.stringify(index, null, 2));
      return ok(msg);
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  'synthesize_manifest',
  'Synthesize every line in content/voice-lines.json. Skips lines whose text and voice have not changed unless force is true.',
  { force: z.boolean().default(false), only: z.array(z.string()).optional().describe('Only these line ids.') },
  async ({ force, only }) => {
    try {
      const manifest = ManifestSchema.parse(JSON.parse(await readFile(MANIFEST_PATH, 'utf8')));
      const index = await readIndex();
      const results: string[] = [];

      for (const line of manifest.lines) {
        if (only && !only.includes(line.id)) continue;
        const unchanged =
          !force && index[line.id]?.textHash === hashOf(line) && existsSync(join(OUT_DIR, `${line.id}.mp3`));
        if (unchanged) {
          results.push(`Skipped ${line.id} (unchanged)`);
          continue;
        }
        results.push(await renderLine(line, index));
      }

      if (!DRY_RUN) await writeFile(INDEX_PATH, JSON.stringify(index, null, 2));
      return ok(results.join('\n'));
    } catch (e) {
      return fail(e);
    }
  },
);

await server.connect(new StdioServerTransport());
console.error(`voice-lines MCP server running on stdio${DRY_RUN ? ' (DRY RUN)' : ''}`);
