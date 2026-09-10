use std::sync::{Mutex, MutexGuard};
use tokio_util::sync::CancellationToken;

pub struct DownloadCancellation {
    active: Mutex<Option<CancellationToken>>,
}

impl DownloadCancellation {
    pub const fn new() -> Self {
        Self {
            active: Mutex::new(None),
        }
    }

    pub fn begin(&self) -> DownloadCancellationGuard<'_> {
        let token = CancellationToken::new();
        *self.active() = Some(token.clone());
        DownloadCancellationGuard { owner: self, token }
    }

    pub fn cancel(&self) {
        if let Some(token) = self.active().as_ref() {
            token.cancel();
        }
    }

    fn active(&self) -> MutexGuard<'_, Option<CancellationToken>> {
        self.active
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }
}

pub struct DownloadCancellationGuard<'a> {
    owner: &'a DownloadCancellation,
    token: CancellationToken,
}

impl DownloadCancellationGuard<'_> {
    pub fn token(&self) -> &CancellationToken {
        &self.token
    }
}

impl Drop for DownloadCancellationGuard<'_> {
    fn drop(&mut self) {
        self.owner.active().take();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn cancel_wakes_an_active_download() {
        let cancellation = DownloadCancellation::new();
        let guard = cancellation.begin();
        cancellation.cancel();

        tokio::time::timeout(Duration::from_millis(100), guard.token().cancelled())
            .await
            .expect("cancellation should wake the waiter");
    }

    #[tokio::test]
    async fn a_new_download_does_not_inherit_the_previous_cancellation() {
        let cancellation = DownloadCancellation::new();
        let guard = cancellation.begin();
        cancellation.cancel();
        drop(guard);

        let next = cancellation.begin();
        assert!(!next.token().is_cancelled());
    }
}
