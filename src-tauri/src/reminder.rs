use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct ReminderPreferences {
    pub native_notification: bool,
    pub floating_window: bool,
    pub screen_dim: bool,
    pub sound: bool,
    pub sustained_bad_seconds: u64,
    pub cooldown_seconds: u64,
    pub display_seconds: u64,
    pub dim_opacity: f32,
}

impl Default for ReminderPreferences {
    fn default() -> Self {
        Self {
            native_notification: true,
            floating_window: true,
            screen_dim: false,
            sound: true,
            sustained_bad_seconds: 12,
            cooldown_seconds: 180,
            display_seconds: 8,
            dim_opacity: 0.34,
        }
    }
}

impl ReminderPreferences {
    pub fn normalized(mut self) -> Self {
        self.sustained_bad_seconds = self.sustained_bad_seconds.clamp(3, 300);
        self.cooldown_seconds = self.cooldown_seconds.clamp(30, 3600);
        self.display_seconds = self.display_seconds.clamp(3, 30);
        self.dim_opacity = self.dim_opacity.clamp(0.12, 0.72);

        // Keep one in-app adapter active so reminders do not silently disappear
        // when the operating system suppresses native notification banners.
        if !self.native_notification && !self.floating_window && !self.screen_dim {
            self.floating_window = true;
        }

        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PostureSignal {
    Unreliable,
    Good,
    Bad,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReminderState {
    WaitingForSignal,
    Good,
    Drifting,
    Cooldown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReminderDecision {
    pub state: ReminderState,
    pub should_remind: bool,
}

/// Converts stable posture signals into sparse reminder events.
///
/// This module deliberately knows nothing about Tauri windows, sounds, or
/// operating-system notifications. Those delivery mechanisms are adapters at
/// the application seam and can fail independently without changing timing.
pub struct ReminderEngine {
    bad_since: Option<Instant>,
    last_reminded_at: Option<Instant>,
}

impl ReminderEngine {
    pub fn new() -> Self {
        Self {
            bad_since: None,
            last_reminded_at: None,
        }
    }

    pub fn reset(&mut self) {
        self.bad_since = None;
        self.last_reminded_at = None;
    }

    pub fn observe(
        &mut self,
        signal: PostureSignal,
        now: Instant,
        preferences: &ReminderPreferences,
    ) -> ReminderDecision {
        match signal {
            PostureSignal::Unreliable => ReminderDecision {
                state: ReminderState::WaitingForSignal,
                should_remind: false,
            },
            PostureSignal::Good => {
                self.bad_since = None;
                ReminderDecision {
                    state: ReminderState::Good,
                    should_remind: false,
                }
            }
            PostureSignal::Bad => {
                let bad_since = *self.bad_since.get_or_insert(now);
                let sustained = now.duration_since(bad_since)
                    >= Duration::from_secs(preferences.sustained_bad_seconds);
                let cooldown_complete = self
                    .last_reminded_at
                    .map(|last| {
                        now.duration_since(last)
                            >= Duration::from_secs(preferences.cooldown_seconds)
                    })
                    .unwrap_or(true);

                if sustained && cooldown_complete {
                    self.last_reminded_at = Some(now);
                    ReminderDecision {
                        state: ReminderState::Cooldown,
                        should_remind: true,
                    }
                } else {
                    ReminderDecision {
                        state: if cooldown_complete {
                            ReminderState::Drifting
                        } else {
                            ReminderState::Cooldown
                        },
                        should_remind: false,
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn waits_for_sustained_bad_posture() {
        let mut engine = ReminderEngine::new();
        let preferences = ReminderPreferences {
            sustained_bad_seconds: 10,
            cooldown_seconds: 60,
            ..ReminderPreferences::default()
        };
        let started = Instant::now();

        assert!(
            !engine
                .observe(PostureSignal::Bad, started, &preferences)
                .should_remind
        );
        assert!(
            !engine
                .observe(
                    PostureSignal::Bad,
                    started + Duration::from_secs(9),
                    &preferences,
                )
                .should_remind
        );
        assert!(
            engine
                .observe(
                    PostureSignal::Bad,
                    started + Duration::from_secs(10),
                    &preferences,
                )
                .should_remind
        );
    }

    #[test]
    fn recovery_resets_the_sustained_timer() {
        let mut engine = ReminderEngine::new();
        let preferences = ReminderPreferences {
            sustained_bad_seconds: 10,
            ..ReminderPreferences::default()
        };
        let started = Instant::now();

        engine.observe(PostureSignal::Bad, started, &preferences);
        engine.observe(
            PostureSignal::Good,
            started + Duration::from_secs(8),
            &preferences,
        );

        assert!(
            !engine
                .observe(
                    PostureSignal::Bad,
                    started + Duration::from_secs(12),
                    &preferences,
                )
                .should_remind
        );
    }

    #[test]
    fn cooldown_prevents_repeated_alerts() {
        let mut engine = ReminderEngine::new();
        let preferences = ReminderPreferences {
            sustained_bad_seconds: 3,
            cooldown_seconds: 60,
            ..ReminderPreferences::default()
        };
        let started = Instant::now();

        engine.observe(PostureSignal::Bad, started, &preferences);
        assert!(
            engine
                .observe(
                    PostureSignal::Bad,
                    started + Duration::from_secs(3),
                    &preferences,
                )
                .should_remind
        );
        assert!(
            !engine
                .observe(
                    PostureSignal::Bad,
                    started + Duration::from_secs(20),
                    &preferences,
                )
                .should_remind
        );
        assert!(
            engine
                .observe(
                    PostureSignal::Bad,
                    started + Duration::from_secs(63),
                    &preferences,
                )
                .should_remind
        );
    }

    #[test]
    fn normalization_keeps_a_reliable_in_app_channel() {
        let preferences = ReminderPreferences {
            native_notification: false,
            floating_window: false,
            screen_dim: false,
            ..ReminderPreferences::default()
        }
        .normalized();

        assert!(preferences.floating_window);
    }
}
