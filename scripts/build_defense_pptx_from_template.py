#!/usr/bin/env python3
from __future__ import annotations

import copy
import os
import re
import shutil
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from PIL import Image, ImageChops


ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "doc/presentation/Шаблон_Презентации_ВЕБ_брендбука_Политеха_для_вкр_ВЕБ_2.pptx"
OUTPUT = ROOT / "doc/presentation/guide-helper-defense.pptx"

THEME = "РАЗРАБОТКА КОРПОРАТИВНОЙ ИНФОРМАЦИОННОЙ СИСТЕМЫ КАРТОГРАФИИ И МАРШРУТОВ"
FOOTER_TOPIC = "РАЗРАБОТКА КОРПОРАТИВНОЙ ИНФОРМАЦИОННОЙ СИСТЕМЫ КАРТОГРАФИИ И МАРШРУТОВ"
STUDENT = "ДУБРОВСКИХ НИКИТА ЕВГЕНЬЕВИЧ"
GROUP = "221-361"
DATE = "июнь 2026"

NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}

for prefix, uri in NS.items():
    ET.register_namespace(prefix, uri)


def q(name: str) -> str:
    prefix, local = name.split(":")
    return f"{{{NS[prefix]}}}{local}"


def iter_slides(base: Path) -> list[Path]:
    slides = list((base / "ppt/slides").glob("slide*.xml"))
    return sorted(slides, key=lambda p: int(re.search(r"slide(\d+)\.xml$", p.name).group(1)))


def texts(sp: ET.Element) -> list[str]:
    return [t.text or "" for t in sp.findall(".//a:t", NS)]


def text_shapes(root: ET.Element) -> list[ET.Element]:
    return [sp for sp in root.findall(".//p:sp", NS) if sp.find(".//p:txBody", NS) is not None]


def shape_plain_text(sp: ET.Element) -> str:
    return "\n".join(t.strip() for t in texts(sp) if t.strip())


def clear_text_body(sp: ET.Element) -> ET.Element:
    tx_body = sp.find("p:txBody", NS)
    if tx_body is None:
        tx_body = ET.SubElement(sp, q("p:txBody"))
        ET.SubElement(tx_body, q("a:bodyPr"))
        ET.SubElement(tx_body, q("a:lstStyle"))
    for child in list(tx_body):
        if child.tag == q("a:p"):
            tx_body.remove(child)
    return tx_body


def run(text: str, size: int = 1500, bold: bool = False) -> ET.Element:
    r = ET.Element(q("a:r"))
    r_pr = ET.SubElement(
        r,
        q("a:rPr"),
        {
            "lang": "ru-RU",
            "sz": str(size),
            "b": "1" if bold else "0",
        },
    )
    fill = ET.SubElement(r_pr, q("a:solidFill"))
    ET.SubElement(fill, q("a:srgbClr"), {"val": "000000"})
    ET.SubElement(r_pr, q("a:latin"), {"typeface": "Gilroy Medium"})
    t = ET.SubElement(r, q("a:t"))
    t.text = text
    return r


def set_shape_text(sp: ET.Element, lines: list[str], size: int = 1500, bold: bool = False) -> None:
    tx_body = clear_text_body(sp)
    for line in lines:
        p = ET.SubElement(tx_body, q("a:p"))
        p_pr = ET.SubElement(p, q("a:pPr"))
        ET.SubElement(p_pr, q("a:defRPr"), {"sz": str(size)})
        p.append(run(line, size=size, bold=bold))
        ET.SubElement(p, q("a:endParaRPr"), {"lang": "ru-RU", "sz": str(size)})


def paragraph(text: str, size: int = 1500, bold: bool = False, bullet: bool = False) -> ET.Element:
    p = ET.Element(q("a:p"))
    attrs = {}
    if bullet:
        attrs = {"marL": "220000", "hanging": "120000"}
    p_pr = ET.SubElement(p, q("a:pPr"), attrs)
    if bullet:
        ET.SubElement(p_pr, q("a:buChar"), {"char": "•"})
    ET.SubElement(p_pr, q("a:defRPr"), {"sz": str(size)})
    p.append(run(text, size=size, bold=bold))
    ET.SubElement(p, q("a:endParaRPr"), {"lang": "ru-RU", "sz": str(size)})
    return p


def make_text_box(shape_id: int, name: str, x: int, y: int, cx: int, cy: int, paragraphs: list[ET.Element]) -> ET.Element:
    sp = ET.Element(q("p:sp"))
    nv = ET.SubElement(sp, q("p:nvSpPr"))
    ET.SubElement(nv, q("p:cNvPr"), {"id": str(shape_id), "name": name})
    ET.SubElement(nv, q("p:cNvSpPr"), {"txBox": "1"})
    ET.SubElement(nv, q("p:nvPr"))
    sp_pr = ET.SubElement(sp, q("p:spPr"))
    xfrm = ET.SubElement(sp_pr, q("a:xfrm"))
    ET.SubElement(xfrm, q("a:off"), {"x": str(x), "y": str(y)})
    ET.SubElement(xfrm, q("a:ext"), {"cx": str(cx), "cy": str(cy)})
    geom = ET.SubElement(sp_pr, q("a:prstGeom"), {"prst": "rect"})
    ET.SubElement(geom, q("a:avLst"))
    ET.SubElement(sp_pr, q("a:noFill"))
    ln = ET.SubElement(sp_pr, q("a:ln"))
    ET.SubElement(ln, q("a:noFill"))
    tx = ET.SubElement(sp, q("p:txBody"))
    ET.SubElement(tx, q("a:bodyPr"), {"wrap": "square", "rtlCol": "0"})
    ET.SubElement(tx, q("a:lstStyle"))
    tx.extend(paragraphs)
    return sp


def max_shape_id(root: ET.Element) -> int:
    ids = []
    for node in root.findall(".//p:cNvPr", NS):
        try:
            ids.append(int(node.attrib.get("id", "0")))
        except ValueError:
            pass
    return max(ids or [100])


def max_rel_id(rels_root: ET.Element) -> int:
    ids = []
    for rel in rels_root.findall("rel:Relationship", NS):
        rid = rel.attrib.get("Id", "")
        if rid.startswith("rId") and rid[3:].isdigit():
            ids.append(int(rid[3:]))
    return max(ids or [0])


def fit_picture_box(image: Path, x: int, y: int, cx: int, cy: int) -> tuple[int, int, int, int]:
    try:
        with Image.open(image) as img:
            img_w, img_h = img.size
    except Exception:
        return x, y, cx, cy

    if img_w <= 0 or img_h <= 0 or cx <= 0 or cy <= 0:
        return x, y, cx, cy

    image_ratio = img_w / img_h
    box_ratio = cx / cy
    if image_ratio >= box_ratio:
        fitted_cx = cx
        fitted_cy = int(cx / image_ratio)
    else:
        fitted_cy = cy
        fitted_cx = int(cy * image_ratio)

    fitted_x = x + (cx - fitted_cx) // 2
    fitted_y = y + (cy - fitted_cy) // 2
    return fitted_x, fitted_y, fitted_cx, fitted_cy


def copy_prepared_image(source: Path, target: Path) -> None:
    try:
        with Image.open(source) as img:
            if img.mode not in ("RGB", "RGBA"):
                img = img.convert("RGBA")
            background = Image.new(img.mode, img.size, (255, 255, 255, 0) if img.mode == "RGBA" else (255, 255, 255))
            diff = ImageChops.difference(img, background)
            bbox = diff.getbbox()
            if bbox is None:
                shutil.copyfile(source, target)
                return

            left, top, right, bottom = bbox
            pad_x = int(img.width * 0.015)
            pad_y = int(img.height * 0.015)
            crop = (
                max(0, left - pad_x),
                max(0, top - pad_y),
                min(img.width, right + pad_x),
                min(img.height, bottom + pad_y),
            )
            cropped = img.crop(crop)
            if cropped.width < img.width * 0.92 or cropped.height < img.height * 0.92:
                cropped.save(target)
                return
    except Exception:
        pass
    shutil.copyfile(source, target)


def add_picture(work: Path, slide_no: int, root: ET.Element, image: Path, x: int, y: int, cx: int, cy: int) -> None:
    media_dir = work / "ppt/media"
    media_dir.mkdir(parents=True, exist_ok=True)
    safe_name = re.sub(r"[^a-zA-Z0-9_.-]+", "_", image.name)
    media_name = f"gh_s{slide_no}_{safe_name}"
    target = media_dir / media_name
    copy_prepared_image(image, target)

    rels_path = work / f"ppt/slides/_rels/slide{slide_no}.xml.rels"
    rels_tree = ET.parse(rels_path)
    rels_root = rels_tree.getroot()
    rid = f"rId{max_rel_id(rels_root) + 1}"
    ET.SubElement(
        rels_root,
        q("rel:Relationship"),
        {
            "Id": rid,
            "Type": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
            "Target": f"../media/{media_name}",
        },
    )
    rels_tree.write(rels_path, encoding="utf-8", xml_declaration=True)

    x, y, cx, cy = fit_picture_box(target, x, y, cx, cy)
    next_id = max_shape_id(root) + 1
    pic = ET.Element(q("p:pic"))
    nv = ET.SubElement(pic, q("p:nvPicPr"))
    ET.SubElement(nv, q("p:cNvPr"), {"id": str(next_id), "name": media_name})
    ET.SubElement(nv, q("p:cNvPicPr"))
    ET.SubElement(nv, q("p:nvPr"))
    blip_fill = ET.SubElement(pic, q("p:blipFill"))
    ET.SubElement(blip_fill, q("a:blip"), {q("r:embed"): rid})
    stretch = ET.SubElement(blip_fill, q("a:stretch"))
    ET.SubElement(stretch, q("a:fillRect"))
    sp_pr = ET.SubElement(pic, q("p:spPr"))
    xfrm = ET.SubElement(sp_pr, q("a:xfrm"))
    ET.SubElement(xfrm, q("a:off"), {"x": str(x), "y": str(y)})
    ET.SubElement(xfrm, q("a:ext"), {"cx": str(cx), "cy": str(cy)})
    geom = ET.SubElement(sp_pr, q("a:prstGeom"), {"prst": "rect"})
    ET.SubElement(geom, q("a:avLst"))
    sp_tree = root.find(".//p:spTree", NS)
    sp_tree.append(pic)


def footer_lines() -> list[str]:
    return [f"{STUDENT},  {GROUP},  {DATE}", FOOTER_TOPIC]


def replace_common(slide_no: int, root: ET.Element) -> None:
    for sp in text_shapes(root):
        text = shape_plain_text(sp)
        if re.fullmatch(r"\d+", text):
            set_shape_text(sp, [str(slide_no)], size=1400)
        elif "ИВАНОВ ИВАН ИВАНОВИЧ" in text and slide_no not in (1, 13):
            set_shape_text(sp, footer_lines(), size=700)
        elif "РАЗРАБОТКА ВЕБ-ПРИЛОЖЕНИЯ" in text and slide_no not in (1, 13):
            set_shape_text(sp, footer_lines(), size=700)


def set_title(root: ET.Element, title: str) -> None:
    candidates = []
    for sp in text_shapes(root):
        text = shape_plain_text(sp)
        if text in {"Заголовок", "Актуальность работы", "Выводы", "Заключение"} or "Цели и задачи" in text or "Программные и технические средства" in text:
            candidates.append(sp)
    if candidates:
        set_shape_text(candidates[0], title.split("\n"), size=2200, bold=False)


def add_content(root: ET.Element, title: str, blocks: list[tuple[str, list[str]]], *, visual: bool = False) -> None:
    set_title(root, title)
    sp_tree = root.find(".//p:spTree", NS)
    next_id = max_shape_id(root) + 1
    left_x, top_y = 620000, 1420000
    box_w = 4550000 if visual else 5200000
    gap_x = 450000
    box_h = 3300000 if visual else 1600000
    gap_y = 250000 if visual else 300000
    for i, (header, bullets) in enumerate(blocks):
        if visual and i > 0:
            break
        col = 0 if visual else i % 2
        row = i if visual else i // 2
        x = left_x + col * (box_w + gap_x)
        y = top_y + row * (box_h + gap_y)
        paras = [paragraph(header, size=1700, bold=True)]
        paras.extend(paragraph(b, size=1380 if visual else 1280, bullet=True) for b in bullets)
        sp_tree.append(make_text_box(next_id, f"Content {next_id}", x, y, box_w, box_h, paras))
        next_id += 1


slides = {
    2: (
        "Актуальность работы",
        [
            ("Пользовательская проблема", [
                "автор маршрута собирает карту, фото, заметки и ссылку в разных инструментах",
                "из-за разрозненности трудно быстро подготовить цельный материал для клиента",
                "опрос подтвердил потребность в едином контуре подготовки и публикации маршрута",
            ]),
        ],
    ),
    3: (
        "Цель и задачи\nработы",
        [
            ("Цель", [
                "разработать систему для сохранения, изменения и публикации маршрутов",
                "поддержать геопривязанные фотографии и публичный просмотр",
                "довести результат до демонстрационного стенда и проверяемой документации",
            ]),
            ("Ключевые блоки задач", [
                "анализ предметной области и аналогов",
                "требования, архитектура, база данных",
                "реализация, тестирование, развёртывание",
            ]),
        ],
    ),
    4: (
        "Анализ предметной области и аналогов",
        [
            ("Проверялся полный сценарий", [
                "карты хорошо показывают места, но не оформляют авторский фотомаршрут",
                "трекеры записывают активность, но слабо подходят для публикации маршрута клиенту",
                "соцсети дают публикацию, но не дают управляемую карту с точками, фото и статистикой",
            ]),
        ],
    ),
    5: (
        "Требования и роли пользователей",
        [
            ("От проблемы к требованиям", [
                "автор маршрута создаёт, редактирует и публикует маршрут",
                "турист находит, просматривает, оценивает и сохраняет маршрут",
                "администратор управляет контентом, категориями, пользователями и настройками",
            ]),
        ],
    ),
    6: (
        "Архитектура системы",
        [],
    ),
    7: (
        "Обработка геопривязанных фотографий",
        [],
    ),
    8: (
        "Клиентский интерфейс автора маршрута",
        [
            ("Основной flow", [
                "автор создаёт маршрут на карте и добавляет точки",
                "к точкам прикрепляются фото, заметки и визуальные настройки",
                "после сохранения маршрут можно опубликовать и переиспользовать",
            ]),
        ],
    ),
    9: (
        "Публичный маршрут и каталог",
        [
            ("Результат для туриста", [
                "маршрут открывается как интерактивная страница",
                "доступны точки, фотографии, описание, оценки и комментарии",
                "каталог помогает находить маршруты по категориям и сезонам",
            ]),
        ],
    ),
    10: (
        "AI и интерактивные функции",
        [
            ("AI — дополнительный интерфейс", [
                "пользователь может текстом попросить найти место или построить маршрут",
                "основной сценарий создания маршрута не зависит от доступности AI",
                "погода, высоты, сложность и исторический слой дают контекст прохождения",
            ]),
        ],
    ),
    11: (
        "Инфраструктура и тестирование",
        [
            ("Проверка качества", [
                "115 модульных тестов",
                "E2E-аудит критических действий в интерфейсе",
                "матрица трассировки подтверждает выполнение 37 требований",
            ]),
        ],
    ),
    12: (
        "Заключение",
        [
            ("Полученный результат", [
                "реализован рабочий контур Guide Helper",
                "закрыт сценарий: создать маршрут → прикрепить фото → опубликовать",
                "подготовлены демонстрационный стенд, документация, E2E-отчёт и fallback для защиты",
            ]),
        ],
    ),
}

IMG = ROOT / "doc"
visuals: dict[int, list[tuple[Path, int, int, int, int]]] = {
    2: [(IMG / "latex/images/mockups/shared-route.png", 5800000, 1450000, 5400000, 3300000)],
    4: [(IMG / "latex/images/mockups/explore.png", 5800000, 1450000, 5400000, 3300000)],
    5: [(IMG / "e2e/20260505T151706-route-creation-audit/screenshots/10-tools-before-save.png", 5800000, 1450000, 5400000, 3300000)],
    6: [(IMG / "presentation/assets/c4-container-slide.png", 2800000, 950000, 8400000, 4750000)],
    7: [(IMG / "presentation/assets/photo-processing-flow.png", 1900000, 1150000, 9200000, 4100000)],
    8: [(IMG / "latex/images/mockups/map-editor.png", 5800000, 1450000, 5400000, 3300000)],
    9: [(IMG / "latex/images/mockups/shared-route.png", 5800000, 1450000, 5400000, 3300000)],
    10: [(IMG / "e2e/20260505T151706-route-creation-audit/screenshots/15-historical-mode.png", 5800000, 1450000, 5400000, 3300000)],
    11: [(IMG / "e2e/20260505T151706-route-creation-audit/screenshots/12-saved-route.png", 5800000, 1450000, 5400000, 3300000)],
}


def update_title_slide(root: ET.Element) -> None:
    for sp in text_shapes(root):
        text = shape_plain_text(sp)
        if "09.03.01" in text:
            set_shape_text(
                sp,
                [
                    "по направлению 09.03.03 Прикладная информатика",
                    "Образовательная программа (профиль) «Корпоративные информационные системы»",
                ],
                size=900,
            )
        elif "РАЗРАБОТКА" in text and "ТЕННИС" in text:
            set_shape_text(sp, ["РАЗРАБОТКА КОРПОРАТИВНОЙ ИНФОРМАЦИОННОЙ", "СИСТЕМЫ КАРТОГРАФИИ И МАРШРУТОВ"], size=1900, bold=True)
        elif "Иванов Иван Иванович" in text:
            set_shape_text(sp, ["Дубровских Никита Евгеньевич,", f"группа {GROUP}"], size=1050)
        elif "Петров Петр Петрович" in text:
            set_shape_text(sp, ["Васильев Денис Борисович,", "старший преподаватель"], size=1050)
        elif "Москва" in text:
            set_shape_text(sp, ["Москва, июнь 2026"], size=850)
    sp_tree = root.find(".//p:spTree", NS)
    current_text = "\n".join(shape_plain_text(sp) for sp in text_shapes(root))
    if sp_tree is not None and "Васильев" not in current_text:
        sp_tree.append(
            make_text_box(
                max_shape_id(root) + 1,
                "Supervisor",
                7250000,
                5150000,
                4200000,
                850000,
                [
                    paragraph("Научный руководитель:", size=850),
                    paragraph("Васильев Денис Борисович,", size=950),
                    paragraph("старший преподаватель", size=950),
                ],
            )
        )


def update_thanks_slide(root: ET.Element) -> None:
    for sp in text_shapes(root):
        text = shape_plain_text(sp)
        if "С п а с и б о" in text:
            set_shape_text(sp, ["С п а с и б о   з а   в н и м а н и е !"], size=1800)
        elif "Иванов Иван Иванович" in text:
            set_shape_text(sp, ["Студент:", f"Дубровских Никита Евгеньевич, группа {GROUP}", "Научный руководитель:", "Васильев Денис Борисович, старший преподаватель"], size=1050)
        elif "Москва" in text:
            set_shape_text(sp, ["Москва, июнь 2026"], size=850)
        elif "РАЗРАБОТКА" in text and "ТЕННИС" in text:
            set_shape_text(sp, ["РАЗРАБОТКА КОРПОРАТИВНОЙ ИНФОРМАЦИОННОЙ", "СИСТЕМЫ КАРТОГРАФИИ И МАРШРУТОВ"], size=1450, bold=True)


def build() -> None:
    if not TEMPLATE.exists():
        raise FileNotFoundError(TEMPLATE)
    with tempfile.TemporaryDirectory() as td:
        work = Path(td)
        with zipfile.ZipFile(TEMPLATE) as z:
            z.extractall(work)
        for slide_path in iter_slides(work):
            slide_no = int(re.search(r"slide(\d+)\.xml$", slide_path.name).group(1))
            tree = ET.parse(slide_path)
            root = tree.getroot()
            if slide_no == 1:
                update_title_slide(root)
            elif slide_no == 13:
                update_thanks_slide(root)
            else:
                replace_common(slide_no, root)
                if slide_no in slides:
                    title, blocks = slides[slide_no]
                    add_content(root, title, blocks, visual=slide_no in visuals)
                    for image, x, y, cx, cy in visuals.get(slide_no, []):
                        if image.exists():
                            add_picture(work, slide_no, root, image, x, y, cx, cy)
            tree.write(slide_path, encoding="utf-8", xml_declaration=True)
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        tmp_output = OUTPUT.with_suffix(".tmp.pptx")
        if tmp_output.exists():
            tmp_output.unlink()
        with zipfile.ZipFile(tmp_output, "w", zipfile.ZIP_DEFLATED) as z:
            for path in sorted(work.rglob("*")):
                if path.is_file():
                    z.write(path, path.relative_to(work).as_posix())
        shutil.move(tmp_output, OUTPUT)
        print(OUTPUT)


if __name__ == "__main__":
    build()
