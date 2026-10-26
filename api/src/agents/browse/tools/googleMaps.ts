import { describeFailure, fetchText } from '../../http.js'
import type { Failure } from './common.js'

/** Whether the place is open. This is the place, not the company's legal status. */
export type BusinessStatus = 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY'

/** One place from the Places API. */
export interface Place {
  name: string
  address: string | null
  website: string | null
  businessStatus: string | null
  url: string
}

/** The places found for a query, or why the search failed. */
export type PlacesResult = { ok: true; places: Place[] } | Failure

// websiteUri is an Enterprise field; businessStatus and formattedAddress are Pro fields.
const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText'

/** Searches the Places API (New) for a text query. */
export async function searchPlaces(text: string, apiKey: string, signal?: AbortSignal): Promise<PlacesResult> {
  try {
    const response = await fetchText(ENDPOINT, {
      method: 'POST',
      body: JSON.stringify({ textQuery: text, languageCode: 'pt-PT', regionCode: 'PT', maxResultCount: 3 }),
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.websiteUri,places.businessStatus,places.googleMapsUri',
      },
      signal,
    })
    if (response.status >= 400) {
      return { ok: false, error: `O Google Maps respondeu ${response.status}: ${response.text.slice(0, 200)}` }
    }
    return { ok: true, places: parsePlaces(response.text, text) }
  } catch (error) {
    return { ok: false, ...describeFailure(error) }
  }
}

/** One place per item of a Places API answer. Missing values are null. */
export function parsePlaces(text: string, query: string): Place[] {
  const data = JSON.parse(text) as { places?: Record<string, unknown>[] }
  const places = Array.isArray(data.places) ? data.places : []
  return places.map((place) => {
    const display = place.displayName as { text?: string } | undefined
    const maps = typeof place.googleMapsUri === 'string' ? place.googleMapsUri : undefined
    return {
      name: display?.text ?? '',
      address: typeof place.formattedAddress === 'string' ? place.formattedAddress : null,
      website: typeof place.websiteUri === 'string' ? place.websiteUri : null,
      businessStatus: typeof place.businessStatus === 'string' ? place.businessStatus : null,
      url: maps ?? `https://maps.google.com/?q=${encodeURIComponent(query)}`,
    }
  })
}
