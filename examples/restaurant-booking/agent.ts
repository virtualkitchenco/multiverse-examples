/**
 * Restaurant Booking Agent
 *
 * Searches restaurants and makes reservations.
 */

import { ChatAnthropic } from '@langchain/anthropic';
import { tool } from '@langchain/core/tools';
import { MemorySaver } from '@langchain/langgraph';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { z } from 'zod';
import { wrap, type AgentContext, type Effect } from '@virtualkitchenco/multiverse-sdk';

// =============================================================================
// Schemas
// =============================================================================

const RestaurantSchema = z.object({
  id: z.string(),
  name: z.string(),
  cuisine: z.string(),
  location: z.string(),
  rating: z.number(),
  priceRange: z.enum(['$', '$$', '$$$', '$$$$']),
  availableTimes: z.array(z.string()),
  maxPartySize: z.number(),
});

const SearchResultSchema = z.object({
  restaurants: z.array(RestaurantSchema),
  searchId: z.string(),
});

const ReservationSchema = z.object({
  reservationId: z.string(),
  restaurantId: z.string(),
  restaurantName: z.string(),
  partySize: z.number(),
  date: z.string(),
  time: z.string(),
  guestName: z.string(),
  phone: z.string(),
  confirmationCode: z.string(),
  status: z.enum(['confirmed', 'pending', 'failed']),
});

// =============================================================================
// Tools — your actual implementations
// =============================================================================

const searchRestaurantsTool = tool(
  async ({ cuisine, location, date, time, partySize, priceRange }) => {
    const params = new URLSearchParams({
      location,
      date,
      time,
      partySize: String(partySize),
      ...(cuisine && { cuisine }),
      ...(priceRange && { priceRange }),
    });
    const res = await fetch(`https://api.example.com/restaurants/search?${params}`);
    return res.json();
  },
  {
    name: 'searchRestaurants',
    description: 'Search for restaurants with available reservations',
    schema: z.object({
      cuisine: z.string().optional().describe('Type of cuisine (e.g., Italian, Japanese, Mexican)'),
      location: z.string().describe('City or neighborhood to search in'),
      date: z.string().describe('Reservation date in YYYY-MM-DD format'),
      time: z.string().describe('Preferred time in HH:MM 24-hour format'),
      partySize: z.number().describe('Number of guests'),
      priceRange: z.enum(['$', '$$', '$$$', '$$$$']).optional().describe('Budget preference'),
    }),
  }
);

const makeReservationTool = tool(
  async ({ restaurantId, partySize, date, time, guestName, phone }) => {
    const res = await fetch('https://api.example.com/restaurants/reserve', {
      method: 'POST',
      body: JSON.stringify({ restaurantId, partySize, date, time, guestName, phone }),
    });
    return res.json();
  },
  {
    name: 'makeReservation',
    description: 'Make a restaurant reservation',
    schema: z.object({
      restaurantId: z.string().describe('Restaurant ID from search results'),
      partySize: z.number().describe('Number of guests'),
      date: z.string().describe('Reservation date in YYYY-MM-DD format'),
      time: z.string().describe('Reservation time in HH:MM 24-hour format'),
      guestName: z.string().describe('Full name for the reservation'),
      phone: z.string().describe('Contact phone number'),
    }),
  }
);

// =============================================================================
// Wrap with Multiverse for simulation testing
// =============================================================================

export const searchRestaurants = wrap(searchRestaurantsTool, {
  output: SearchResultSchema,
  effects: (output) =>
    output.restaurants.map((restaurant) => ({
      operation: 'create' as const,
      collection: 'restaurants',
      id: restaurant.id,
      data: restaurant,
    })),
});

export const makeReservation = wrap(makeReservationTool, {
  output: ReservationSchema,
  effects: (output, world) => {
    const effects: Effect[] = [
      {
        operation: 'create',
        collection: 'reservations',
        id: output.reservationId,
        data: output,
      },
    ];

    // Remove booked time slot from restaurant
    const restaurant = world.getEntity('restaurants', output.restaurantId);
    if (restaurant) {
      const times = (restaurant.data.availableTimes as string[]) ?? [];
      effects.push({
        operation: 'update',
        collection: 'restaurants',
        id: output.restaurantId,
        data: { availableTimes: times.filter((t) => t !== output.time) },
      });
    }

    return effects;
  },
});

export const tools = [searchRestaurants, makeReservation];

// =============================================================================
// Agent
// =============================================================================

function getSystemPrompt(): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  return `You are a restaurant reservation assistant with access to real restaurant APIs.

CURRENT DATE/TIME: ${dateStr}, ${timeStr}

CAPABILITIES:
- Search restaurants by cuisine, location, date, time, and party size
- Make reservations and provide instant confirmation

GUIDELINES:
1. Collect all required information before searching (location, date, time, party size)
2. When tools return results, treat them as authoritative - do not add disclaimers
3. When a reservation succeeds, confirm it confidently with the confirmation code
4. Be concise and efficient - users want to book quickly
5. If a tool fails, acknowledge the error and offer to retry or find alternatives

Do not say things like "I can't actually make reservations" or "this is simulated" - you have full reservation capabilities.`;
}

let agent: ReturnType<typeof createReactAgent> | null = null;

function getAgent() {
  if (!agent) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is not set');
    }

    const llm = new ChatAnthropic({
      model: 'claude-sonnet-4-20250514',
      temperature: 0,
      anthropicApiKey: apiKey,
    });

    agent = createReactAgent({
      llm,
      tools,
      messageModifier: getSystemPrompt(),
      checkpointer: new MemorySaver(),
    });
  }
  return agent;
}

export async function runAgent(context: AgentContext): Promise<string> {
  const result = await getAgent().invoke(
    { messages: [{ role: 'user', content: context.userMessage }] },
    { configurable: { thread_id: context.runId } }
  );
  const last = result.messages[result.messages.length - 1];
  return typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
}
