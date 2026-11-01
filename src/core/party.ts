/**
 * The Party (#31): a companion for each area of life. Loot for a quest comes from its area's
 * companion, in a cozy trail theme. Every item is a real reward or a line that means something,
 * written for anyone. Nothing costs money. The odds live in rules.ts and don't change here.
 */
import type { Rarity } from "./types";

export type CompanionId =
  | "guide"
  | "healer"
  | "quartermaster"
  | "artificer"
  | "hearthkeeper"
  | "ranger"
  | "bard"
  | "merchant"
  | "envoy"
  | "scholar";

export interface Companion {
  id: CompanionId;
  /** "The Healer". */
  name: string;
  icon: string;
  /** One line in their voice. */
  voice: string;
  /** Area names that belong to them, matched whole (case doesn't matter). */
  areas: readonly string[];
  /** Words that point to them inside an area's name you wrote yourself ("Gym days" → the Healer). */
  words: readonly string[];
}

export const COMPANIONS: readonly Companion[] = [
  {
    id: "guide",
    name: "The Guide",
    icon: "🧭",
    voice: "Every trail starts with one step. You took it.",
    areas: ["Getting started"],
    words: [],
  },
  {
    id: "healer",
    name: "The Healer",
    icon: "🌿",
    voice: "Rest is part of the journey.",
    areas: ["Health", "Strength", "Health & safety net"],
    words: [
      "health",
      "healthy",
      "strength",
      "fitness",
      "gym",
      "exercise",
      "workout",
      "running",
      "yoga",
      "sleep",
      "rest",
      "wellness",
      "wellbeing",
      "doctor",
      "medical",
      "meds",
      "selfcare",
      "garden",
      "gardening",
    ],
  },
  {
    id: "quartermaster",
    name: "The Quartermaster",
    icon: "🎒",
    voice: "Packed and ready. You're more prepared than you feel.",
    areas: ["Work", "Career"],
    words: [
      "work",
      "job",
      "jobs",
      "career",
      "interview",
      "interviews",
      "applications",
      "resume",
      "networking",
      "business",
    ],
  },
  {
    id: "artificer",
    name: "The Artificer",
    icon: "⚙️",
    voice: "Ship it, then rest.",
    areas: ["Programming"],
    words: ["programming", "code", "coding", "dev", "developer", "software", "tech", "engineering"],
  },
  {
    id: "hearthkeeper",
    name: "The Hearthkeeper",
    icon: "🔥",
    voice: "A clean corner is a place to land.",
    areas: ["Home", "Next home", "House"],
    words: ["home", "house", "housing", "apartment", "chores", "cleaning", "kitchen", "laundry", "moving"],
  },
  {
    id: "ranger",
    name: "The Ranger",
    icon: "🐾",
    voice: "Your animal thinks you're doing great.",
    areas: ["Pet"],
    words: ["pet", "pets", "dog", "dogs", "cat", "cats", "puppy", "kitten", "bash"],
  },
  {
    id: "bard",
    name: "The Bard",
    icon: "🎶",
    voice: "Make something. It doesn't have to be good.",
    areas: ["Art"],
    words: ["art", "music", "guitar", "piano", "writing", "drawing", "painting", "creative", "photography", "singing"],
  },
  {
    id: "merchant",
    name: "The Merchant",
    icon: "🪙",
    voice: "Small steps add up, like coins in a jar.",
    areas: ["Money"],
    words: ["money", "budget", "bills", "rent", "finance", "finances", "savings", "taxes", "debt", "bank"],
  },
  {
    id: "envoy",
    name: "The Envoy",
    icon: "🤝",
    voice: "The people who care about you are glad you exist.",
    areas: ["Friends & family"],
    words: ["friends", "friend", "family", "social", "relationships", "kids", "partner", "community"],
  },
  {
    id: "scholar",
    name: "The Scholar",
    icon: "📜",
    voice: "Curiosity is its own kind of map.",
    areas: ["Learning"],
    words: ["learning", "learn", "study", "school", "class", "classes", "course", "reading", "books", "language"],
  },
];

const GUIDE = COMPANIONS[0];
const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);

/** Who hands out loot for an area: a whole-name match first, then a word in the name, else the Guide. */
export function companionFor(area: string | undefined): Companion {
  const a = (area ?? "").trim().toLowerCase();
  if (!a) return GUIDE;
  const exact = COMPANIONS.find((c) => c.areas.some((x) => x.toLowerCase() === a));
  if (exact) return exact;
  const ws = words(a);
  return COMPANIONS.find((c) => c.words.some((w) => ws.includes(w))) ?? GUIDE;
}

export function companionById(id: string | undefined): Companion | undefined {
  return COMPANIONS.find((c) => c.id === id);
}

type Item = readonly [name: string, desc: string];
type Pack = Record<Exclude<Rarity, "legendary">, readonly Item[]>;

/** The two legendaries are shared: any companion can hand one over. */
export const LEGENDARY: readonly Item[] = [
  ["Crown of Forward Motion", "Reward: a full afternoon off, zero guilt. You earned it."],
  ["North Star", "Reward: an hour on the dream you keep putting off."],
];

/** Each pack: 8 common, 5 rare, 3 epic. The Artificer's adds a Code set to its core (any craft). */
export const PACKS: Record<CompanionId, Pack> = {
  guide: {
    common: [
      ["Trail Marker", "You were here. It counts."],
      ["Smooth Stone", "Proof you moved. Pocket it."],
      ["Lantern Oil", "Reward: 10 minutes of guilt-free anything."],
      ["First Footprint", "The hardest step is the first one. Done."],
      ["Pocket Compass", "You know which way is forward."],
      ["Lucky Pebble", "Small, steady, yours."],
      ["Trail Mix", "Reward: a handful of something you like."],
      ["Spark", "Reward: two minutes of doing nothing at all."],
    ],
    rare: [
      ["Thaw Crystal", "The freeze cracked. Remember how that felt."],
      ["Map Fragment", "One more piece of the way forward."],
      ["Signpost", "You found your way back on track."],
      ["Waystone", "Reward: a fifteen-minute break, fully earned."],
      ["Lantern", "Reward: put on something cozy and slow down for ten minutes."],
    ],
    epic: [
      ["Second Wind", "You've started over before. You know the way."],
      ["Explorer's Journal", "Read back what you did this week. It's more than you think."],
      ["Open Road", "Reward: a few hours with nothing planned."],
    ],
  },
  healer: {
    common: [
      ["Canteen Refill", "Reward: a tall glass of something good."],
      ["Warm Socks", "Reward: change into something comfortable."],
      ["Fresh Air", "Reward: five minutes outside, no phone."],
      ["Stretching Ribbon", "Reward: one long, slow stretch."],
      ["Sunlit Bench", "Reward: five minutes in the sun, or by a window."],
      ["Honey Drop", "Reward: something sweet, eaten slowly."],
      ["Deep Breath Stone", "Reward: five slow breaths. Count them."],
      ["Clear Spring", "Your body thanks you for that."],
    ],
    rare: [
      ["Hot Spring Map", "Reward: a hot shower or bath, no rush."],
      ["Bedroll", "Reward: twenty minutes of real rest, no guilt."],
      ["Herb Pouch", "Reward: a walk somewhere green."],
      ["Healer's Balm", "Reward: be gentle with your body for the rest of the day."],
      ["Mountain Air", "Reward: open a window and stretch for five minutes."],
    ],
    epic: [
      ["Healer's Tea", "Reward: an evening off from everything but the basics."],
      ["Phoenix Feather", "You've recovered before. You're recovering now."],
      ["Sanctuary Key", "Reward: an early night, phone across the room."],
    ],
  },
  quartermaster: {
    common: [
      ["Ready Pack", "You did the prep. That's most of it."],
      ["Ration Tin", "Reward: a proper lunch break, away from the screen."],
      ["Signal Flare", "Reward: tell one person what you just finished."],
      ["Polished Boots", "You showed up ready. That's half of it."],
      ["Sealed Envelope", "One more out the door. That counts, whatever comes back."],
      ["Map Pin", "Reward: a five-minute break before the next one."],
      ["Spare Rope", "Reward: stretch, refill your water, then decide what's next."],
      ["Steady Lamp", "Slow progress is still progress."],
    ],
    rare: [
      ["Compass of Focus", "Reward: 30 minutes on something you're curious about."],
      ["Letter of Introduction", "Your work speaks for you. Let it."],
      ["Recommendation Scroll", "Reward: reread something kind someone said about your work."],
      ["Supply Crate", "Reward: an hour off from the job hunt, guilt-free."],
      ["Strong Handshake", "Reward: tell a friend how it went."],
    ],
    epic: [
      ["Quartermaster's Ledger", "Look at everything you've sent out this month. That took nerve."],
      ["Banner of the Brave", "Rejection is part of the road. You kept walking."],
      ["Keys to a New Door", "Reward: an evening that's only yours."],
    ],
  },
  artificer: {
    common: [
      // Any craft
      ["Sharpened Tools", "Reward: 15 minutes practicing just for skill."],
      ["Finished Piece", "Something you made is done."],
      ["Tidy Workbench", "Reward: clear your workspace, then stop for the day."],
      ["Steady Hands", "You did the careful part."],
      ["Fresh Notebook", "Reward: start something new, just for fun."],
      ["Good Light", "Reward: work somewhere comfortable for a while."],
      ["Quiet Hour", "Reward: an hour without notifications."],
      ["Apron Hook", "Reward: hang it up. You're done for today."],
      // Code
      ["Green Build", "Every check passed. Enjoy it for a second."],
      ["Clean Commit", "Something got shipped today."],
      ["Rubber Duck", "Reward: talk the problem out loud, then a five-minute break."],
      ["Squashed Bug", "That bug is gone. Enjoy that."],
    ],
    rare: [
      ["Master's Notes", "Reward: learn one trick from someone better than you."],
      ["Apprentice's Pride", "Reward: show someone what you built."],
      ["Craftsman's Stamp", "Your work has your name on it."],
      ["Inspiration Spark", "Reward: 20 minutes looking at work you admire."],
      ["Lucky Tool", "Reward: use your favorite tool on something just for fun."],
      ["Mechanical Keyboard of Focus", "Reward: 30 minutes on a fun side project."],
      ["Cup of Good Coffee", "Reward: make the good stuff."],
    ],
    epic: [
      ["Masterwork", "Look at what you made. That's real."],
      ["Guild Seal", "You're better at this than a year ago. Truly."],
      ["Long Weekend Project", "Reward: a whole afternoon on something you love making."],
      ["Merged to Main", "It's in. Reward: close the laptop."],
    ],
  },
  hearthkeeper: {
    common: [
      ["Swept Hearth", "Reward: sit for a minute in the space you just cleared."],
      ["Open Window", "Reward: fresh air for five minutes."],
      ["Kettle Song", "Reward: a warm drink, taken slowly."],
      ["Folded Laundry", "One less pile. Breathe easier."],
      ["Fresh Pillow", "Reward: lie down for five minutes."],
      ["Clear Table", "Reward: eat at it, slowly."],
      ["Little Plant", "Reward: notice one thing in your space you like."],
      ["Lamp Glow", "Reward: make the light warm for the evening."],
    ],
    rare: [
      ["Cozy Blanket", "Reward: twenty minutes curled up with something you like."],
      ["Candle Stub", "Reward: dim the lights and breathe for a while."],
      ["Comfort Recipe", "Reward: make something warm you love."],
      ["Slippers of Rest", "Reward: shoes off, feet up, twenty minutes."],
      ["Window Seat", "Reward: sit and watch the world for a while."],
    ],
    epic: [
      ["Hearth of Your Own", "You're building somewhere to land, one corner at a time."],
      ["Deep Clean Glow", "Look around. You did that."],
      ["Day of Rest", "Reward: a full day with no chores."],
    ],
  },
  ranger: {
    common: [
      ["Squeaky Ball", "Reward: 10 minutes of play with your pet."],
      ["Extra Belly Rub", "For your pet. Also kind of for you."],
      ["Trail Treat", "Reward: a treat for your animal."],
      ["Brushing Comb", "Reward: five minutes of brushing or petting."],
      ["Fresh Water Bowl", "They're cared for. You did that."],
      ["Sunny Spot", "Reward: sit with your animal in the sun."],
      ["Tug Rope", "Reward: a quick game of tug or chase."],
      ["Happy Tail", "Someone at home thinks you're the best."],
    ],
    rare: [
      ["Golden Tennis Ball", "Reward: a longer walk somewhere you both like."],
      ["New Smell Map", "Reward: take a different route today and let them sniff."],
      ["Park Pass", "Reward: a visit to their favorite place."],
      ["Toy Box Rotation", "Reward: bring back an old toy they've forgotten."],
      ["Nap Buddy", "Reward: a nap together."],
    ],
    epic: [
      ["Treat of Champions", "Reward: a real treat for you, and one for them."],
      ["Best Friend's Collar", "You show up for them every day. That's love."],
      ["Adventure Day", "Reward: a long outing somewhere new for both of you."],
    ],
  },
  bard: {
    common: [
      ["Campfire Song", "Reward: one song you love, played loud."],
      ["Spare String", "Reward: ten minutes of making anything, just for fun."],
      ["Ink Pot", "Reward: doodle, hum or scribble for five minutes."],
      ["Sketchbook Page", "Reward: one quick sketch, any subject."],
      ["Humming Stone", "Reward: hum or sing one song."],
      ["Color Swatch", "Reward: notice five colors around you."],
      ["Little Rhyme", "Reward: write four lines about today."],
      ["Encore", "You made something. That's the whole point."],
    ],
    rare: [
      ["Bard's Playlist", "Reward: put on something you love while you work."],
      ["Open Stage", "Reward: show someone what you made."],
      ["Gallery Visit", "Reward: 20 minutes with art you love."],
      ["Jam Session", "Reward: play or make something with someone."],
      ["Lute of Play", "Reward: make something badly, on purpose, for fun."],
    ],
    epic: [
      ["Muse's Feather", "Reward: an hour to make whatever you want, no goal."],
      ["Masterpiece Frame", "Reward: put something you made where you'll see it."],
      ["Festival Night", "Reward: an evening of music, a show or a movie you love."],
    ],
  },
  merchant: {
    common: [
      ["Copper Coin", "You looked. That's the hard part."],
      ["Free Sample", "Reward: something nice that costs nothing: a library book, a walk, a podcast."],
      ["Balanced Scale", "Reward: five calm minutes before the next thing."],
      ["Receipt Scroll", "Filed. One less thing on your mind."],
      ["Silver Thread", "Small steps add up."],
      ["Calm Abacus", "Reward: a slow breath before the next number."],
      ["Penny Noticed", "You paid attention. That's the habit."],
      ["Market Stroll", "Reward: a free walk somewhere you like."],
    ],
    rare: [
      ["Lucky Coin", "Proof you can face the numbers."],
      ["Closed Ledger", "Reward: the rest of today with no money decisions."],
      ["Free Evening", "Reward: an evening with only free plans."],
      ["Clear Skies", "Reward: let tomorrow's money worries wait until tomorrow."],
      ["Guild Receipt", "You kept your word to yourself."],
    ],
    epic: [
      ["Full Coin Jar", "Look back at every money task you've faced. That took nerve."],
      ["Treasure Map", "Reward: daydream about one thing you're saving toward."],
      ["Steady Keel", "Money is rough water. You kept steering."],
    ],
  },
  envoy: {
    common: [
      ["Sealed Letter", "Reward: send one kind message, no reply needed."],
      ["Waved Hello", "Someone was glad to hear from you."],
      ["Shared Bread", "Reward: eat with someone, or call someone while you eat."],
      ["Kind Word", "Reward: tell someone one thing you appreciate about them."],
      ["Old Photo", "Reward: look at a photo of someone you love."],
      ["Message in a Bottle", "Reward: send a song or a joke to a friend."],
      ["Open Door", "Someone's glad you reached out."],
      ["Shared Laugh", "Reward: call the person who makes you laugh."],
    ],
    rare: [
      ["Hearthstone", "Reward: call or text someone who feels like home."],
      ["Friendship Bracelet", "Reward: plan one small thing with a friend."],
      ["Campfire Circle", "Reward: time with your people, any size."],
      ["Postcard", "Reward: a short note to someone far away."],
      ["Two Cups", "Reward: coffee or tea with someone."],
    ],
    epic: [
      ["Innkeeper's Feast", "Reward: a real meal with someone you like."],
      ["Reunion Banner", "Reward: plan a visit with someone you miss."],
      ["Fellowship Ring", "You're not walking this alone."],
    ],
  },
  scholar: {
    common: [
      ["Bookmark", "You'll know where you left off."],
      ["Reading Candle", "Reward: twenty minutes with something you chose to read."],
      ["Margin Note", "Reward: write down one thing you learned."],
      ["Curious Lens", "Reward: look up one thing you've wondered about."],
      ["Pocket Glossary", "You know a word you didn't yesterday."],
      ["Study Lamp", "Reward: ten quiet minutes with a page or a video."],
      ["Question Stone", "Good questions count as progress."],
      ["Ink-Stained Fingers", "You put in the work today."],
    ],
    rare: [
      ["Rabbit Hole Map", "Reward: follow one curiosity for 30 minutes."],
      ["Library Card", "Reward: borrow something new, for free."],
      ["Lecture Ticket", "Reward: a talk or documentary you've been meaning to watch."],
      ["Puzzle Box", "Reward: a puzzle, game or riddle, just for fun."],
      ["Mentor's Letter", "Reward: ask someone you admire one question."],
    ],
    epic: [
      ["Cartographer's Atlas", "Look how far you've come. Open your Journey."],
      ["Key to the Archive", "Reward: an afternoon of learning whatever you like."],
      ["Lightbulb Moment", "Remember when it clicked? Hold onto that."],
    ],
  },
};

/** The items a companion can hand over at a rarity. Legendaries are shared by everyone. */
export function poolFor(id: CompanionId, rar: Rarity): readonly Item[] {
  return rar === "legendary" ? LEGENDARY : PACKS[id][rar];
}

/** How many different items a companion's own pack holds (legendaries not counted). */
export function packSize(id: CompanionId): number {
  const p = PACKS[id];
  return p.common.length + p.rare.length + p.epic.length;
}

/** "🌿 The Healer", for an item that records who handed it over. */
export function handedBy(item: { by?: string }): string | null {
  const c = companionById(item.by);
  return c ? `${c.icon} ${c.name}` : null;
}

/** How many times an item with this name is in the bag (1 = first time). */
export function timesFound(inv: readonly { n: string }[], name: string): number {
  return inv.filter((it) => it.n === name).length;
}

/** How many different items from a companion's own pack are in the bag. */
export function foundFrom(inv: readonly { n: string; by?: string; rar: Rarity }[], id: CompanionId): number {
  return new Set(inv.filter((it) => it.by === id && it.rar !== "legendary").map((it) => it.n)).size;
}
