/**
 * Demo Agent for CI Integration
 *
 * Flight booking agent that demonstrates the Multiverse CI flow.
 * This matches the example from the main multiverse repo.
 */

import { ChatAnthropic } from '@langchain/anthropic';
import { tool } from '@langchain/core/tools';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { z } from 'zod';
import { wrap, type WorldStateAccessor } from '@virtualkitchenco/multiverse-sdk';

// =============================================================================
// Output Schemas - Define the shape of tool responses
// =============================================================================

const FlightSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  price: z.number(),
  airline: z.string(),
  departure: z.string(),
  arrival: z.string(),
  seatsAvailable: z.number(),
});

const SearchResultSchema = z.object({
  flights: z.array(FlightSchema),
  searchId: z.string(),
});

const BookingSchema = z.object({
  bookingId: z.string(),
  flightId: z.string(),
  passengerName: z.string(),
  status: z.enum(['confirmed', 'pending', 'failed']),
  totalPrice: z.number(),
  confirmationCode: z.string(),
});

// Type aliases
type SearchResult = z.infer<typeof SearchResultSchema>;
type Flight = z.infer<typeof FlightSchema>;
type Booking = z.infer<typeof BookingSchema>;

// =============================================================================
// Tool Definitions (LangChain tools)
// =============================================================================

const searchFlightsTool = tool(
  async () => ({} as SearchResult), // Real implementation not used in sim
  {
    name: 'searchFlights',
    description: 'Search for available flights between two cities on a specific date',
    schema: z.object({
      from: z.string().describe('Departure airport code (e.g., SFO, LAX, JFK)'),
      to: z.string().describe('Arrival airport code (e.g., NYC, SEA, MIA)'),
      departureDate: z.string().describe('Departure date in YYYY-MM-DD format'),
      returnDate: z.string().optional().describe('Return date for round-trip (YYYY-MM-DD), omit for one-way'),
      passengers: z.number().describe('Number of passengers'),
      cabinClass: z.enum(['economy', 'business', 'first']).optional().describe('Cabin class preference'),
    }),
  }
);

const bookFlightTool = tool(
  async () => ({} as Booking), // Real implementation not used in sim
  {
    name: 'bookFlight',
    description: 'Book a flight and process payment',
    schema: z.object({
      flightId: z.string().describe('Flight ID from search results'),
      passengerName: z.string().describe('Full name of primary passenger'),
      email: z.string().describe('Email for booking confirmation'),
      creditCard: z.object({
        number: z.string().describe('Credit card number'),
        expiry: z.string().describe('Expiry date (MM/YY)'),
        cvv: z.string().describe('CVV code'),
      }).describe('Payment details'),
    }),
  }
);

// =============================================================================
// Wrap Tools with Multiverse for simulation
// =============================================================================

export const searchFlights = wrap(searchFlightsTool, {
  name: 'searchFlights',
  description: 'Search for available flights between two cities on a specific date',
  outputSchema: SearchResultSchema,
  // Search results populate the flights collection
  effects: (output: SearchResult) =>
    output.flights.map((flight: Flight) => ({
      operation: 'create' as const,
      collection: 'flights',
      id: flight.id,
      data: flight,
    })),
});

export const bookFlight = wrap(bookFlightTool, {
  name: 'bookFlight',
  description: 'Book a flight and process payment',
  outputSchema: BookingSchema,
  // Booking creates a booking record AND decrements available seats
  effects: (output: Booking, world: WorldStateAccessor) => {
    const effects: Array<{ operation: 'create' | 'update'; collection: string; id: string; data: object }> = [
      {
        operation: 'create',
        collection: 'bookings',
        id: output.bookingId,
        data: output,
      },
    ];

    // Decrement seats on the booked flight
    const flight = world.getEntity('flights', output.flightId);
    if (flight) {
      const currentSeats = (flight.data.seatsAvailable as number) ?? 0;
      effects.push({
        operation: 'update',
        collection: 'flights',
        id: output.flightId,
        data: { seatsAvailable: currentSeats - 1 },
      });
    }

    return effects;
  },
  // Invariant: seats can never go negative
  invariants: [
    { collection: 'flights', field: 'seatsAvailable', condition: 'gte', value: 0 },
  ],
});

export const tools = [searchFlights, bookFlight];

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

  return `You are a flight booking assistant with access to real airline APIs.

CURRENT DATE/TIME: ${dateStr}, ${timeStr}

CAPABILITIES:
- Search flights across all major airlines
- Book flights and process payments
- Handle one-way and round-trip bookings

GUIDELINES:
1. Collect all required information before searching (dates, passengers, airports)
2. When tools return results, treat them as authoritative - do not add disclaimers
3. When a booking succeeds, confirm it confidently - you have real API access
4. Be concise and efficient - users want to book quickly
5. If a tool fails, acknowledge the error and offer to retry or find alternatives

Do not say things like "I can't actually book flights" or "this is simulated" - you have full booking capabilities.`;
}

// Lazy initialization to ensure env vars are available
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
    });
  }
  return agent;
}

export async function runAgent(context?: {
  userMessage?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<string> {
  try {
    const message = context?.userMessage ||
      'Book me the cheapest flight from SFO to NYC for 1 passenger';

    const messages = [
      ...(context?.history || []).map(h => ({
        role: h.role === 'assistant' ? 'assistant' : 'user',
        content: h.content
      })),
      { role: 'user', content: message },
    ];

    console.log('[demo-agent] Invoking agent with message:', message.substring(0, 80) + '...');
    const result = await getAgent().invoke({ messages });

    const last = result.messages[result.messages.length - 1];
    const response = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
    console.log('[demo-agent] Agent response:', response.substring(0, 100) + '...');

    return response;
  } catch (error) {
    console.error('[demo-agent] Error invoking agent:', error);
    throw error;
  }
}
