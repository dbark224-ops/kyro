import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  imageSizeForPrompt,
  looksLikeKyroImageGenerationRequest,
} from "./generation";

describe("image generation intent detection", () => {
  it("routes explicit image and rendering requests to the image tool", () => {
    assert.equal(
      looksLikeKyroImageGenerationRequest(
        "Generate an Instagram graphic for a blocked drain special",
      ),
      true,
    );
    assert.equal(
      looksLikeKyroImageGenerationRequest(
        "Show what this bathroom renovation could look like after we retile it",
      ),
      true,
    );
    assert.equal(
      looksLikeKyroImageGenerationRequest(
        "Create a bathroom rendering from the attached photo",
      ),
      true,
    );
    assert.equal(
      looksLikeKyroImageGenerationRequest(
        "Can you create an mage of a high end luxury bathroom looking over Sydney Harbour",
      ),
      true,
    );
    assert.equal(
      looksLikeKyroImageGenerationRequest(
        "Make me a luxury kitchen concept with a view of the city",
      ),
      true,
    );
    assert.equal(
      looksLikeKyroImageGenerationRequest("Edit the image so it is nighttime"),
      true,
    );
    assert.equal(
      looksLikeKyroImageGenerationRequest(
        "Redo the render with warmer lighting",
      ),
      true,
    );
  });

  it("does not steal quote or document creation requests just because they name a room", () => {
    assert.equal(
      looksLikeKyroImageGenerationRequest("Create a bathroom quote draft"),
      false,
    );
    assert.equal(
      looksLikeKyroImageGenerationRequest(
        "Create a quote document for the kitchen job",
      ),
      false,
    );
  });
});

describe("image generation sizing", () => {
  it("maps prompt aspect ratio language to supported OpenAI image sizes", () => {
    assert.equal(
      imageSizeForPrompt("Create a wide 16:9 hero image of a Queenslander"),
      "1536x1024",
    );
    assert.equal(
      imageSizeForPrompt("Make a vertical 9:16 phone story for Instagram"),
      "1024x1536",
    );
    assert.equal(
      imageSizeForPrompt("Generate a square 9:9 logo-style image"),
      "1024x1024",
    );
    assert.equal(
      imageSizeForPrompt("Generate an image of a typical Queenslander house"),
      "auto",
    );
  });
});
