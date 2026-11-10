import { NextRequest, NextResponse } from 'next/server';
import { requireApiPermission } from '@/lib/server/session';
import { db } from '@/lib/db';
import { writeAudit } from '@/lib/audit';
import { deepseek, DEEPSEEK_MODEL } from '@/lib/ai/deepseek-client';
import { buildSystemPrompt } from '@/lib/ai/system-prompt';
import { tools as registeredTools, TOOL_FRIENDLY_NAMES } from '@/lib/ai/tools';
import { hasUsableDeepSeekKey, streamDemoChat } from '@/lib/ai/demo-responder';
import type { ToolDb } from '@/lib/ai/tools/db';

export const dynamic = 'force-dynamic';

export type ChatToolCallDelta = {
  index: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
};

export type ChatDelta = {
  content?: string;
  tool_calls?: ChatToolCallDelta[];
};

export type ChatStreamChunk = {
  choices?: Array<{ delta?: ChatDelta; finish_reason?: string | null }>;
};

export type ChatMessage = {
  role: string;
  content?: string | null;
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
};

export type ChatCompletionParams = {
  model: string;
  messages: ChatMessage[];
  tools: unknown;
  tool_choice: string;
  stream: boolean;
};

/**
 * Minimal structural view of the OpenAI-compatible client used for streaming.
 * The real `deepseek` instance is adapted once via a cast; tests supply a small
 * fake with the same shape.
 */
export type ChatStreamClient = {
  chat: {
    completions: {
      create: (params: ChatCompletionParams) => Promise<AsyncIterable<ChatStreamChunk>>;
    };
  };
};

type RegisteredChatTool = {
  run: (
    projectId: string,
    userId: string,
    args: Record<string, unknown>,
    dbClient: ToolDb
  ) => Promise<unknown>;
};

const formattedTools = registeredTools.map((t) => ({
  type: 'function' as const,
  function: t.schema,
}));

const toolMap = new Map<string, RegisteredChatTool>();
for (const t of registeredTools) {
  toolMap.set(t.schema.name, t as unknown as RegisteredChatTool);
}

export async function processChatRequest(
  projectId: string,
  userId: string,
  messages: ChatMessage[],
  clientOverride?: ChatStreamClient,
  dbClient: ToolDb = db as unknown as ToolDb
) {
  const client = clientOverride ?? (deepseek as unknown as ChatStreamClient);

  const project = await dbClient.projects.findUnique({
    where: { id: projectId },
    select: { name: true, project_code: true, tenant_id: true },
  });

  const tenantId = project?.tenant_id || '';

  if (!hasUsableDeepSeekKey()) {
    return streamDemoChat(projectId, userId, tenantId, messages, dbClient);
  }

  const systemPrompt = buildSystemPrompt({
    projectName: project?.name,
    projectCode: project?.project_code,
    projectId,
  });

  const conversationHistory: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  const MAX_ROUNDS = 6;
  let round = 0;
  const toolsCalled: string[] = [];
  let auditWritten = false;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        while (round < MAX_ROUNDS) {
          round++;

          const responseStream = await client.chat.completions.create({
            model: DEEPSEEK_MODEL,
            messages: conversationHistory,
            tools: formattedTools,
            tool_choice: 'auto',
            stream: true,
          });

          const toolCallsAcc: Array<{ id: string; name: string; arguments: string }> = [];
          let roundContent = '';
          let finishReason: string | null = null;

          for await (const chunk of responseStream) {
            const choice = chunk.choices?.[0];
            if (!choice) continue;

            if (choice.finish_reason) {
              finishReason = choice.finish_reason;
            }

            const delta = choice.delta;
            if (!delta) continue;

            // Accumulate tool_calls deltas by index
            if (delta.tool_calls) {
              for (const tcDelta of delta.tool_calls) {
                const idx = tcDelta.index;
                if (toolCallsAcc[idx] === undefined) {
                  toolCallsAcc[idx] = {
                    id: tcDelta.id || '',
                    name: tcDelta.function?.name || '',
                    arguments: tcDelta.function?.arguments || '',
                  };
                } else {
                  if (tcDelta.id) toolCallsAcc[idx].id = tcDelta.id;
                  if (tcDelta.function?.name) toolCallsAcc[idx].name += tcDelta.function.name;
                  if (tcDelta.function?.arguments) toolCallsAcc[idx].arguments += tcDelta.function.arguments;
                }
              }
            }

            // Text content delta
            if (delta.content) {
              roundContent += delta.content;

              // Stream NDJSON content event to client ONLY if no tool calls are being accumulated in this round
              if (toolCallsAcc.length === 0) {
                if (!auditWritten) {
                  auditWritten = true;
                  const userPrompt = messages.findLast((m) => m.role === 'user')?.content || 'AI Chat Query';
                  await writeAudit({
                    tenantId,
                    projectId,
                    actorUserId: userId,
                    action: 'AI_CHAT_QUERY',
                    entityType: 'ai_chat',
                    metadata: {
                      userQuestion: typeof userPrompt === 'string' ? userPrompt.slice(0, 200) : 'Query',
                      toolsCalled: Array.from(new Set(toolsCalled)),
                    },
                  });
                }

                controller.enqueue(
                  encoder.encode(JSON.stringify({ type: 'content', delta: delta.content }) + '\n')
                );
              }
            }
          }

          // Check if this round executed tool calls
          if (toolCallsAcc.length > 0 || finishReason === 'tool_calls') {
            conversationHistory.push({
              role: 'assistant',
              content: roundContent || null,
              tool_calls: toolCallsAcc.map((tc) => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.name, arguments: tc.arguments },
              })),
            });

            for (const tc of toolCallsAcc) {
              toolsCalled.push(tc.name);

              // Emit NDJSON tool_call event to client before executing tool
              controller.enqueue(
                encoder.encode(
                  JSON.stringify({
                    type: 'tool_call',
                    name: tc.name,
                    label: TOOL_FRIENDLY_NAMES[tc.name] || tc.name,
                  }) + '\n'
                )
              );

              let parsedArgs: Record<string, unknown> = {};
              try {
                parsedArgs = JSON.parse(tc.arguments || '{}');
              } catch {
                parsedArgs = {};
              }

              const targetTool = toolMap.get(tc.name);
              let result: unknown;
              if (targetTool) {
                result = await targetTool.run(projectId, userId, parsedArgs, dbClient);
              } else {
                result = { restricted: true, reason: `Tool '${tc.name}' is not recognized.` };
              }

              conversationHistory.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: JSON.stringify(result),
              });
            }

            // Loop to next round
            continue;
          }

          // Final response round finished
          if (!auditWritten) {
            auditWritten = true;
            const userPrompt = messages.findLast((m) => m.role === 'user')?.content || 'AI Chat Query';
            await writeAudit({
              tenantId,
              projectId,
              actorUserId: userId,
              action: 'AI_CHAT_QUERY',
              entityType: 'ai_chat',
              metadata: {
                userQuestion: typeof userPrompt === 'string' ? userPrompt.slice(0, 200) : 'Query',
                toolsCalled: Array.from(new Set(toolsCalled)),
              },
            });
          }

          controller.enqueue(encoder.encode(JSON.stringify({ type: 'done' }) + '\n'));
          controller.close();
          return;
        }

        // Max rounds exceeded
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              type: 'error',
              message: 'AI chat loop exceeded maximum tool execution rounds.',
            }) + '\n'
          )
        );
        controller.close();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Internal Server Error during chat processing';
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              type: 'error',
              message,
            }) + '\n'
          )
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { projectId?: string; messages?: ChatMessage[] };
    const { projectId, messages } = body || {};

    if (!projectId || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: 'Both projectId and messages array are required.' },
        { status: 400 }
      );
    }

    const auth = await requireApiPermission('ai_chat.use', projectId);
    if (auth instanceof NextResponse) {
      return auth;
    }

    return await processChatRequest(projectId, auth.appUser.id, messages);
  } catch (error: unknown) {
    console.error('[AI Chat Route Error]:', error);
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
