export const GET_JOBS = `
  query GetJobs($first: Int, $skip: Int) {
    jobs(first: $first, skip: $skip, orderBy: createdAt, orderDirection: desc) {
      id
      client
      provider
      evaluator
      description
      budget
      status
      createdAt
      createdTx
      activities(first: 10, orderBy: timestamp, orderDirection: desc) {
        id
        action
        actor
        timestamp
        txHash
      }
    }
  }
`;

export const GET_JOBS_BY_ADDRESS = `
  query GetJobsByAddress($account: Bytes!, $first: Int) {
    jobs(
      first: $first,
      where: { or: [{ client: $account }, { provider: $account }] },
      orderBy: createdAt,
      orderDirection: desc
    ) {
      id
      client
      provider
      description
      budget
      status
      createdAt
    }
  }
`;

export const GET_GLOBAL_STATS = `
  query GetGlobalStats {
    globalStats(id: "global") {
      totalJobs
      totalFunded
      totalCompleted
      totalRejected
    }
  }
`;

export const GET_JOB_ACTIVITIES = `
  query GetJobActivities($jobId: String!, $first: Int) {
    jobActivities(
      first: $first,
      where: { job: $jobId },
      orderBy: timestamp,
      orderDirection: desc
    ) {
      id
      action
      actor
      deliverable
      reason
      timestamp
      txHash
    }
  }
`;
