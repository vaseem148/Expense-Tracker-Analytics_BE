/**
 * Keyword -> category matcher used during import when the ML service is not
 * reachable. Ordered by specificity: the first hit wins, so put narrow rules
 * above broad ones.
 */
export const CATEGORY_RULES: { category: string; patterns: string[] }[] = [
  { category: 'Groceries', patterns: ['bigbasket', 'dmart', 'grofers', 'blinkit', 'zepto', 'reliance fresh', 'supermarket', 'kirana'] },
  { category: 'Restaurants', patterns: ['swiggy', 'zomato', 'dominos', 'pizza', 'restaurant', 'hotel', 'biryani', 'kfc', 'mcdonald'] },
  { category: 'Coffee', patterns: ['starbucks', 'cafe', 'coffee', 'chai point', 'third wave'] },
  { category: 'Fuel', patterns: ['petrol', 'diesel', 'hpcl', 'bpcl', 'indian oil', 'shell', 'fuel'] },
  { category: 'Cab & Ride', patterns: ['uber', 'ola', 'rapido', 'cab', 'taxi'] },
  { category: 'Public Transit', patterns: ['metro', 'irctc', 'railway', 'bus ticket', 'redbus'] },
  { category: 'Rent', patterns: ['rent', 'landlord', 'lease'] },
  { category: 'Electricity', patterns: ['electricity', 'tneb', 'bescom', 'power bill', 'msedcl'] },
  { category: 'Internet', patterns: ['broadband', 'airtel fiber', 'jio fiber', 'act fibernet', 'internet'] },
  { category: 'Mobile', patterns: ['airtel', 'jio', 'vodafone', 'vi recharge', 'mobile recharge'] },
  { category: 'Streaming', patterns: ['netflix', 'spotify', 'prime video', 'hotstar', 'youtube premium', 'sony liv'] },
  { category: 'Pharmacy', patterns: ['pharmacy', 'apollo', 'medplus', 'netmeds', 'pharmeasy', 'chemist'] },
  { category: 'Doctor', patterns: ['hospital', 'clinic', 'diagnostic', 'lab test', 'practo'] },
  { category: 'Fitness', patterns: ['gym', 'cult fit', 'fitness', 'yoga'] },
  { category: 'Clothing', patterns: ['myntra', 'ajio', 'zara', 'h&m', 'lifestyle', 'westside', 'clothing'] },
  { category: 'Electronics', patterns: ['croma', 'reliance digital', 'apple store', 'electronics'] },
  { category: 'Shopping', patterns: ['amazon', 'flipkart', 'meesho', 'nykaa', 'shopping'] },
  { category: 'Travel', patterns: ['makemytrip', 'goibibo', 'indigo', 'air india', 'vistara', 'oyo', 'airbnb', 'booking.com'] },
  { category: 'Education', patterns: ['udemy', 'coursera', 'school fee', 'college', 'tuition', 'byju'] },
  { category: 'Insurance', patterns: ['insurance', 'lic', 'policy premium', 'hdfc ergo', 'star health'] },
  { category: 'Fees & Charges', patterns: ['charges', 'fee', 'penalty', 'gst on', 'service tax', 'annual fee'] },
  { category: 'Subscriptions', patterns: ['subscription', 'membership', 'renewal', 'saas'] },
  { category: 'Salary', patterns: ['salary', 'payroll', 'stipend', 'wages'] },
  { category: 'Investments', patterns: ['dividend', 'mutual fund', 'zerodha', 'groww', 'interest credit'] },
  { category: 'Refunds', patterns: ['refund', 'reversal', 'cashback'] },
];

/** Returns the category NAME to use, or null when nothing matches. */
export function guessCategory(text: string): string | null {
  const hay = text.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((p) => hay.includes(p))) return rule.category;
  }
  return null;
}
