import { App, Plugin, PluginSettingTab, Setting, TFile, Notice } from 'obsidian';
import { GoogleGenerativeAI } from '@google/generative-ai';

interface DailyRecallSettings {
    folderPath: string;
    geminiApiKey: string;
    lastSummaryDate: string;
}

const DEFAULT_SETTINGS: DailyRecallSettings = {
    folderPath: '',
    geminiApiKey: '',
    lastSummaryDate: ''
}

export default class DailyRecallPlugin extends Plugin {
    settings: DailyRecallSettings;
    gemini: GoogleGenerativeAI;

    async onload() {
        await this.loadSettings();
        
        // Initialize Gemini if API key exists
        if (this.settings.geminiApiKey) {
            this.gemini = new GoogleGenerativeAI(this.settings.geminiApiKey);
        }

        // Add command
        this.addCommand({
            id: 'generate-daily-recall',
            name: 'Generate Daily Recall',
            callback: async () => {
                await this.generateDailyRecall();
            }
        });

        // Check for new day every hour
        this.registerInterval(
            window.setInterval(async () => {
                if (this.isNewDay()) {
                    await this.generateDailyRecall();
                }
            }, 1000 * 60 * 60)
        );

        // Add settings tab
        this.addSettingTab(new DailyRecallSettingTab(this.app, this));

        // Generate initial recall if it's a new day
        if (this.isNewDay()) {
            this.generateDailyRecall();
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    isNewDay(): boolean {
        const today = new Date().toDateString();
        return today !== this.settings.lastSummaryDate;
    }

    async generateDailyRecall() {
        if (!this.settings.geminiApiKey) {
            new Notice('Please set your Gemini API key in settings');
            return;
        }

        if (!this.settings.folderPath) {
            new Notice('Please set your source folder path in settings');
            return;
        }

        try {
            // Get files from specified folder
            const files = this.app.vault.getMarkdownFiles().filter(file => 
                file.path.startsWith(this.settings.folderPath)
            );

            if (files.length === 0) {
                new Notice('No markdown files found in the specified folder');
                return;
            }

            // Pick random file
            const randomFile = files[Math.floor(Math.random() * files.length)];
            const content = await this.app.vault.read(randomFile);

            // Generate summary
            const summary = await this.generateSummary(content);

            // Create recall note content
            const today = new Date().toLocaleDateString();
            const recallContent = [
                `# Daily Recall - ${today}`,
                '',
                `## Today's Random Note: ${randomFile.basename}`,
                '',
                summary,
                '',
                '---',
                `Original note: [[${randomFile.basename}]]`
            ].join('\n');

            // Create or update recall.md
            const recallPath = 'recall.md';
            if (await this.app.vault.adapter.exists(recallPath)) {
                const recallFile = this.app.vault.getAbstractFileByPath(recallPath) as TFile;
                await this.app.vault.modify(recallFile, recallContent);
            } else {
                await this.app.vault.create(recallPath, recallContent);
            }

            // Update last summary date
            this.settings.lastSummaryDate = new Date().toDateString();
            await this.saveSettings();

            new Notice('Daily recall updated!');
        } catch (error) {
            console.error(error);
            new Notice('Error generating recall. Check console for details.');
        }
    }

    async generateSummary(content: string): Promise<string> {
        try {
            const model = this.gemini.getGenerativeModel({ model: "gemini-1.5-flash" });
            
            const prompt = `Create a concise summary focusing on key points. Use markdown formatting with headers and bullet points where appropriate.

Summarize this note:

${content}`;

            const result = await model.generateContent(prompt);
            const response = await result.response;
            return response.text() || "No summary generated";
        } catch (error) {
            console.error('Gemini API error:', error);
            throw new Error('Failed to generate summary');
        }
    }
}

class DailyRecallSettingTab extends PluginSettingTab {
    plugin: DailyRecallPlugin;

    constructor(app: App, plugin: DailyRecallPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName('Source Folder Path')
            .setDesc('Path to the folder containing notes to summarize')
            .addText(text => text
                .setPlaceholder('folder/path')
                .setValue(this.plugin.settings.folderPath)
                .onChange(async (value) => {
                    this.plugin.settings.folderPath = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Gemini API Key')
            .setDesc('Your Google Gemini API key')
            .addText(text => text
                .setPlaceholder('AIza...')
                .setValue(this.plugin.settings.geminiApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.geminiApiKey = value;
                    if (value) {
                        this.plugin.gemini = new GoogleGenerativeAI(value);
                    }
                    await this.plugin.saveSettings();
                }));
    }
}
