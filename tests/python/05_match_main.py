def note_text(note):
    match note:
        case 1:
            return "Sehr gut"
        case 2:
            return "Gut"
        case 3 | 4:
            return "Passt"
        case _:
            return "Nicht genügend"


def main():
    for n in range(1, 6):
        print(n, note_text(n))
    t = "ja"
    if t == "ja" or t == "j":
        print("ok")


if __name__ == "__main__":
    main()
