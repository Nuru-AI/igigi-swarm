/**
 * The swarm's internal exchange layer — what makes pay_agent an *economy* rather
 * than charity. Agents post findings for sale; another agent pays (real on-chain
 * via pay_agent) and receives the content. In-process (the swarm runs all agents
 * in one node process), so the board is shared; the payment is real on-chain.
 *
 * This is the work-for-money channel Run 1 lacked: an agent can BUY research from
 * another instead of doing it itself — the precondition for a real internal market.
 */
export interface Listing {
  id: number;
  seller: string;      // agent label (e.g. "A1")
  sellerAddr: string;  // seller's sovereign wallet (where the buyer pays)
  summary: string;     // public teaser the buyer sees before paying
  content: string;     // the goods, revealed only after payment
  priceUSD: number;
}

export class Marketplace {
  private items: Listing[] = [];
  private nextId = 1;

  post(seller: string, sellerAddr: string, summary: string, content: string, priceUSD: number): number {
    const id = this.nextId++;
    this.items.push({ id, seller, sellerAddr, summary, content, priceUSD });
    return id;
  }

  /** Public view (no content) of listings from OTHER agents. */
  list(excludeSeller?: string): Array<Pick<Listing, 'id' | 'seller' | 'summary' | 'priceUSD'>> {
    return this.items
      .filter((i) => i.seller !== excludeSeller)
      .map((i) => ({ id: i.id, seller: i.seller, summary: i.summary, priceUSD: i.priceUSD }));
  }

  get(id: number): Listing | undefined {
    return this.items.find((i) => i.id === id);
  }
}
