# Reference data

Small, fixed datasets committed to the repo so the analysis can be reproduced
without depending on outside services.

## `bikepoint_2024-08-20.json.gz`

An archived copy of the TfL BikePoint API response (`https://api.tfl.gov.uk/BikePoint`)
as it was in August 2024. It lists the docking stations close to the time of the
journey data we analyse (1–14 July 2024).

|              |                                                                                  |
| ------------ | -------------------------------------------------------------------------------- |
| Source       | Internet Archive Wayback Machine                                                 |
| Capture      | 2024-08-20 00:25:05 UTC                                                          |
| Archived URL | `https://web.archive.org/web/20240820002505id_/https://api.tfl.gov.uk/BikePoint` |
| Stations     | 794                                                                              |
| Format       | gzip-compressed JSON, exactly as served by the archive                           |
| SHA-256      | `c9b2fd4295b47922fe05b05547f35a1a712ff8871cf1e8a21d3cdc71c1ecb2be`               |

### Why we use it instead of today's station list

Station locations are only available from the live BikePoint API, which describes
the network **today**, not when the journeys were made. Comparing the two showed
that today's list is wrong for 2024 journeys in three ways:

- **Closed stations.** Ten stations used in July 2024 have since closed, e.g.
  Southwark Station 2 and Marylebone Lane, about 8,900 journey ends. They are
  missing from today's list but present in this snapshot.
- **Reused terminal numbers.** TfL has given some old terminal numbers to new
  stations elsewhere. For example, `001058` was Edgware Road Station, Marylebone in
  2024 but is now Orchard Place, Blackwall Tunnel, 12 km away. The station names
  in the July 2024 journey file match this snapshot, not today's list.
- **Small relocations.** A few stations have moved tens of metres.

This snapshot is missing five stations that were used in July 2024 and still exist
today (perhaps temporarily closed when it was captured). The analysis fills those
gaps from today's list and records which source each station's location came from.
