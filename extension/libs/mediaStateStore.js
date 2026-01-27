export class MediaStateStore {
  /**
   * @param {StateManager} stateManager
   * A persistent key–value store backed by chrome.storage.
   * This class uses it to save and restore media state across service-worker restarts.
   */
  constructor(stateManager) {
    this.stateManager = stateManager;

    /**
     * The storage key under which all media state is stored.
     * Structure:
     * {
     *   [tabId: number]: {
     *     playback: "PLAYING" | "PAUSED",
     *     currentTime: number,
     *     duration: number,
     *     muted: boolean
     *   }
     * }
     */
    this.key = "mediaStateByTab";
  }

  /**
   * Initializes the store.
   * Ensures that the media state map exists in persistent storage.
   * This must be called once on background startup.
   */
  async load() {
    const data = this.stateManager.get(this.key);

    // If no media state exists yet, create an empty map
    if (!data) {
      await this.stateManager.set({ [this.key]: {} });
    }
  }

  /**
   * Returns the media state for a single tab.
   * @param {number} tabId
   * @returns {object | undefined} Media state for the tab, or undefined if not tracked yet
   */
  get(tabId) {
    return this.stateManager.get(this.key)[tabId];
  }

  /**
   * Returns the full media state map.
   * @returns {Object<number, object>} A map of tabId → media state
   */
  getAll() {
    return this.stateManager.get(this.key);
  }

  /**
   * Updates (or creates) the media state for a specific tab.
   * Only the provided fields are updated — all other existing fields are preserved.
   *
   * @param {number} tabId
   * @param {object} partial
   * Example: { playback: "PLAYING" } or { currentTime: 120 }
   */
  async set(tabId, partial) {
    // Load the current state for all tabs
    const all = this.stateManager.get(this.key);

    // Merge the new partial state into the existing tab state
    all[tabId] = {
      ...(all[tabId] || {}), // Preserve existing fields if the tab was already tracked
      ...partial            // Overwrite or add only the provided fields
    };

    // Persist the updated state map
    await this.stateManager.set({ [this.key]: all });
  }

  /**
   * Removes a tab’s media state.
   * Called when a tab is closed or is no longer a media tab.
   *
   * @param {number} tabId
   */
  async remove(tabId) {
    // Load the current state map
    const all = this.stateManager.get(this.key);

    // Delete the entry for this tab
    delete all[tabId];

    // Persist the updated map
    await this.stateManager.set({ [this.key]: all });
  }
}
