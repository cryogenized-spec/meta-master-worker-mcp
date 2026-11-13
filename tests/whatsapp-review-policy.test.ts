import { describe, expect, it } from "vitest";
import { reviewReason } from "../src/modules/whatsapp/review-policy";

describe("WhatsApp initial review policy", () => {
  it("sends regulated product questions for review, not autonomous sales", () => {
    for(const message of [
      "Do you have a Blow Mini 9?",
      "Do you sell blank guns?",
      "What is the price of a PCP rifle?",
      "Any CO2 pistol cartridges?",
      "Can I get a payday loan?",
    ]) {
      expect(reviewReason("text",message)).toBe("regulated_or_sensitive_topic");
    }
  });
  it("captures human support requests", () => {
    expect(reviewReason("text","Can I speak to a real person?")).toBe("customer_requests_human");
    expect(reviewReason("text","Please call me")).toBe("customer_requests_human");
  });
  it("routes unsupported content and leaves normal enquiries received", () => {
    expect(reviewReason("unsupported",null)).toBe("unsupported_content_requires_human");
    expect(reviewReason("text","What are your store hours?")).toBeNull();
    expect(reviewReason("text","Can you tell me about your return policy?")).toBeNull();
  });
});
