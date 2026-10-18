use crate::{PollId, PollSummary};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum PollBulkAction {
    Duplicate,
    Delete,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PollBulkPlan {
    pub plan_token: String,
    pub action: PollBulkAction,
    pub targets: Vec<PollSummary>,
    pub available: usize,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PollBulkCreated {
    pub source_id: PollId,
    pub poll_id: PollId,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum PollBulkWindowStage {
    Create,
    Show,
    Destroy,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum PollBulkRecovery {
    ShowPoll,
    RetryWindowCleanup,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum PollBulkIssueCode {
    Internal,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PollBulkWindowIssue {
    pub poll_id: PollId,
    pub stage: PollBulkWindowStage,
    pub code: PollBulkIssueCode,
    pub message: String,
    pub recovery: PollBulkRecovery,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PollBulkResult {
    pub operation_token: String,
    pub action: PollBulkAction,
    pub definitions_committed: bool,
    pub created: Vec<PollBulkCreated>,
    pub removed_ids: Vec<PollId>,
    pub polls: Vec<PollSummary>,
    pub issues: Vec<PollBulkWindowIssue>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BulkOperationPrepare {
    pub operation_token: String,
    pub action: PollBulkAction,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BulkOperationRelease {
    pub operation_token: String,
}
