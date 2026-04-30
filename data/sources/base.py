from dataclasses import dataclass
from typing import Literal, Protocol

AreaLevel = Literal["local_authority", "region", "country"]


@dataclass(frozen=True)
class AreaRent:
    area_code: str
    area_name: str
    area_level: AreaLevel
    monthly_rent_gbp: int
    period: str  # ISO month, e.g. "2026-03"
    source: str


class RentSource(Protocol):
    name: str

    def fetch(self) -> list[AreaRent]:
        ...
