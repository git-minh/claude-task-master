/**
 * openrouter-client.js
 * OpenRouter API client with Anthropic compatibility layer
 */

import fetch from 'node-fetch';
import { EventEmitter } from 'events';
import { log } from './utils.js';

export class OpenRouterClient {
    constructor(config) {
        this.apiKey = config.apiKey;
        this.baseURL = config.baseURL || 'https://openrouter.ai/api/v1';
        // Add anthropic/ prefix if not already present
        this.defaultModel = config.defaultModel || 'claude-3-7-sonnet-20250219';
        if (!this.defaultModel.includes('/')) {
            this.defaultModel = `anthropic/${this.defaultModel}`;
        }
    }

    /**
     * Create a streaming chat completion
     * @param {Object} params - Chat completion parameters
     * @returns {AsyncGenerator} Stream of response chunks
     */
    async *createChatCompletionStream(params) {
        const url = `${this.baseURL}/chat/completions`;
        const headers = {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/taskmaster-ai/taskmaster',
            'X-Title': 'Task Master CLI'
        };

        // Add anthropic/ prefix to model if not present
        let model = params.model || this.defaultModel;
        if (!model.includes('/')) {
            model = `anthropic/${model}`;
        }

        // Convert Anthropic format to OpenRouter format
        const messages = params.messages.map(msg => ({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: msg.content
        }));

        // Add system message if provided
        if (params.system) {
            messages.unshift({
                role: 'system',
                content: params.system
            });
        }

        const body = {
            model,
            messages,
            stream: true,
            temperature: params.temperature || 0.2,
            max_tokens: params.max_tokens || 64000
        };

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(`OpenRouter API error: ${error.message || response.statusText}`);
            }

            // Handle streaming response
            for await (const chunk of response.body) {
                const lines = chunk.toString().split('\n');
                
                for (const line of lines) {
                    if (line.trim() === '') continue;
                    if (line.trim() === 'data: [DONE]') return;
                    
                    try {
                        const data = JSON.parse(line.replace(/^data: /, ''));
                        // Convert to Anthropic-like format
                        yield {
                            type: 'content_block_delta',
                            delta: {
                                text: data.choices[0]?.delta?.content || ''
                            }
                        };
                    } catch (e) {
                        // Skip invalid JSON lines (e.g. 'data: ' prefix)
                        continue;
                    }
                }
            }
        } catch (error) {
            log('error', `OpenRouter streaming error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Create a chat completion with streaming
     * Provides Anthropic SDK compatibility
     */
    messages = {
        create: async (params) => {
            const stream = this.createChatCompletionStream(params);
            return {
                [Symbol.asyncIterator]: () => stream
            };
        }
    };
} 