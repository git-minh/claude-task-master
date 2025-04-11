/**
 * add-task.js
 * Direct function implementation for adding a new task
 */

import { addTask } from '../../../../scripts/modules/task-manager.js';
import { findTasksJsonPath } from '../utils/path-utils.js';
import {
	enableSilentMode,
	disableSilentMode
} from '../../../../scripts/modules/utils.js';
import {
	getAnthropicClientForMCP,
	getModelConfig
} from '../utils/ai-client-utils.js';
import {
	_buildAddTaskPrompt,
	parseTaskJsonResponse,
	_handleAnthropicStream
} from '../../../../scripts/modules/ai-services.js';

/**
 * Direct function wrapper for adding a new task with error handling.
 *
 * @param {Object} args - Command arguments
 * @param {string} [args.prompt] - Description of the task to add (required if not using manual fields)
 * @param {string} [args.title] - Task title (for manual task creation)
 * @param {string} [args.description] - Task description (for manual task creation)
 * @param {string} [args.details] - Implementation details (for manual task creation)
 * @param {string} [args.testStrategy] - Test strategy (for manual task creation)
 * @param {string} [args.dependencies] - Comma-separated list of task IDs this task depends on
 * @param {string} [args.priority='medium'] - Task priority (high, medium, low)
 * @param {string} [args.file='tasks/tasks.json'] - Path to the tasks file
 * @param {string} [args.projectRoot] - Project root directory
 * @param {boolean} [args.research=false] - Whether to use research capabilities for task creation
 * @param {Object} log - Logger object
 * @param {Object} context - Additional context (reportProgress, session)
 * @returns {Promise<Object>} - Result object { success: boolean, data?: any, error?: { code: string, message: string } }
 */
export async function addTaskDirect(args, log, { session }) {
	try {
		// Enable silent mode to prevent console logs from interfering with JSON response
		enableSilentMode();

		// Find the tasks.json path
		const tasksPath = findTasksJsonPath(args, log, session);

		// Check if this is manual task creation or AI-driven task creation
		const isManualCreation = args.title && args.description;

		// Check required parameters
		if (!args.prompt && !isManualCreation) {
			log.error(
				'Missing required parameters: either prompt or title+description must be provided'
			);
			disableSilentMode();
			return {
				success: false,
				error: {
					code: 'MISSING_PARAMETER',
					message:
						'Either the prompt parameter or both title and description parameters are required for adding a task'
				}
			};
		}

		// Extract and prepare parameters
		const prompt = args.prompt;
		const dependencies = Array.isArray(args.dependencies)
			? args.dependencies
			: args.dependencies
				? String(args.dependencies)
						.split(',')
						.map((id) => parseInt(id.trim(), 10))
				: [];
		const priority = args.priority || 'medium';

		let manualTaskData = null;

		if (isManualCreation) {
			// Create manual task data object
			manualTaskData = {
				title: args.title,
				description: args.description,
				details: args.details || '',
				testStrategy: args.testStrategy || ''
			};

			log.info(
				`Adding new task manually with title: "${args.title}", dependencies: [${dependencies.join(', ')}], priority: ${priority}`
			);

			// Call the addTask function with manual task data
			const newTaskId = await addTask(
				tasksPath,
				null, // No prompt needed for manual creation
				dependencies,
				priority,
				{
					mcpLog: log,
					session
				},
				'json', // Use JSON output format to prevent console output
				null, // No custom environment
				manualTaskData // Pass the manual task data
			);

			// Restore normal logging
			disableSilentMode();

			return {
				success: true,
				data: {
					taskId: newTaskId,
					message: `Successfully added new task #${newTaskId}`
				}
			};
		} else {
			// AI-driven task creation
			log.info(
				`Adding new task with prompt: "${prompt}", dependencies: [${dependencies.join(', ')}], priority: ${priority}`
			);

			// Initialize AI client with session environment
			let localAnthropic;
			try {
				localAnthropic = getAnthropicClientForMCP(session, log);
			} catch (error) {
				log.error(`Failed to initialize Anthropic client: ${error.message}`);
				disableSilentMode();
				return {
					success: false,
					error: {
						code: 'AI_CLIENT_ERROR',
						message: `Cannot initialize AI client: ${error.message}`
					}
				};
			}

			// Get model configuration from session
			const modelConfig = getModelConfig(session);

			// Read existing tasks to provide context
			let tasksData;
			try {
				const fs = await import('fs');
				tasksData = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
			} catch (error) {
				log.warn(`Could not read existing tasks for context: ${error.message}`);
				tasksData = { tasks: [] };
			}

			// Build prompts for AI
			const { systemPrompt, userPrompt } = _buildAddTaskPrompt(
				prompt,
				tasksData.tasks
			);

			// Make the AI call using the streaming helper
			let responseText;
			try {
				responseText = await _handleAnthropicStream(
					localAnthropic,
					{
						model: modelConfig.model,
						max_tokens: modelConfig.maxTokens,
						temperature: modelConfig.temperature,
						messages: [{ role: 'user', content: userPrompt }],
						system: systemPrompt
					},
					{
						mcpLog: log
					}
				);
			} catch (error) {
				log.error(`AI processing failed: ${error.message}`);
				disableSilentMode();
				return {
					success: false,
					error: {
						code: 'AI_PROCESSING_ERROR',
						message: `Failed to generate task with AI: ${error.message}`
					}
				};
			}

			// Parse the AI response
			let taskDataFromAI;
			try {
				taskDataFromAI = parseTaskJsonResponse(responseText);
			} catch (error) {
				log.error(`Failed to parse AI response: ${error.message}`);
				disableSilentMode();
				return {
					success: false,
					error: {
						code: 'RESPONSE_PARSING_ERROR',
						message: `Failed to parse AI response: ${error.message}`
					}
				};
			}

			// Call the addTask function with 'json' outputFormat to prevent console output when called via MCP
			const newTaskId = await addTask(
				tasksPath,
				prompt,
				dependencies,
				priority,
				{
					mcpLog: log,
					session
				},
				'json',
				null,
				taskDataFromAI // Pass the parsed AI result as the manual task data
			);

			// Restore normal logging
			disableSilentMode();

			return {
				success: true,
				data: {
					taskId: newTaskId,
					message: `Successfully added new task #${newTaskId}`
				}
			};
		}
	} catch (error) {
		// Make sure to restore normal logging even if there's an error
		disableSilentMode();

		log.error(`Error in addTaskDirect: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'ADD_TASK_ERROR',
				message: error.message
			}
		};
	}
}
