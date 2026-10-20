/**
 * calendar.js
 * Reads today's schedule from macOS Calendar.app via AppleScript.
 * Provides the assistant with current meeting and appointment context.
 */

const { exec } = require('child_process');

class AppleCalendarService {
  constructor() {
    this.enabled = process.env.ENABLE_APPLE_CALENDAR !== 'false';
  }

  async getTodayEvents() {
    if (!this.enabled) return null;

    return new Promise((resolve) => {
      // AppleScript to query today's events from macOS Calendar.app
      const appleScript = `
        set output to ""
        try
          tell application "Calendar"
            set now to current date
            set dayStart to now - (time of now)
            set dayEnd to dayStart + 86400
            repeat with c in calendars
              set evs to (every event of c whose start date >= dayStart and start date < dayEnd)
              repeat with e in evs
                set output to output & "- " & (summary of e) & " (" & (time string of (start date of e)) & " - " & (time string of (end date of e)) & ")\\n"
              end repeat
            end repeat
          end tell
        on error
          set output to ""
        end try
        return output
      `;

      exec(`osascript -e '${appleScript.replace(/\n/g, ' ')}'`, (err, stdout) => {
        if (err || !stdout) {
          return resolve(null);
        }
        const trimmed = stdout.trim();
        resolve(trimmed.length > 0 ? trimmed : null);
      });
    });
  }
}

module.exports = new AppleCalendarService();
