import { moment as obsidianMoment } from "obsidian";

// Obsidian supplies the runtime; its namespace declaration needs a callable type.
export const moment = obsidianMoment as unknown as typeof obsidianMoment.default;
