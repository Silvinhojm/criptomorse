export const GET_USER_PORTFOLIO = `
  query GetUserPortfolio($account: String!) {
    users(where: { id: $account }) {
      id
      balances {
        tokenAddress
        symbol
        amount
      }
      totalTrades
    }
  }
`;
